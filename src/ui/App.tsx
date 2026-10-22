import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Route as RouterRoute, Routes, useNavigate } from 'react-router-dom'
import { ArrowDownToLine, ArrowUpFromLine, Bell, ChartNoAxesColumn, Check, Clock3, Home, MapPin, Plus, Route as RouteIcon, Search, Settings2, Trash2, Wallet, X } from 'lucide-react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { exportCsv, formatFortaleza, formatPrice, fromFortalezaIso, importCsv, emptyData, observationInputSchema, routeInputSchema, toFortalezaIso, type AppData, type Observation, type Route as RideRoute } from '../domain'
import { supabase } from '../lib/supabase'
import { clearRideRecords, createObservation, createRoute, deleteObservation as deleteObservationRecord, deleteRoute as deleteRouteRecord, loadUserData, updateRoute as updateRouteRecord } from '../lib/repository'
import { calculateForecasts, formatWindow, type ForecastGroup, type ForecastWindow } from '../forecast'

type Page = 'inicio' | 'rotas' | 'historico' | 'previsoes'
const pageNames: Record<Page, string> = { inicio: 'Visão geral', rotas: 'Minhas rotas', historico: 'Histórico', previsoes: 'Previsões' }
function App() {
  if (!supabase) return <SetupRequired />
  return <AuthGate client={supabase} />
}

function SetupRequired() {
  return <main className="auth-shell"><section className="auth-card"><div className="brand auth-brand"><span className="brand-icon"><Wallet size={19}/></span><span>Preço<span className="brand-green">Certo</span></span></div><div className="eyebrow">CONFIGURAÇÃO NECESSÁRIA</div><h1>Conecte seu projeto Supabase</h1><p>O app não salva dados localmente. Configure URL e chave publicável do Supabase para entrar e usar seu banco com políticas RLS.</p><ol><li>Copie <code>.env.example</code> para <code>.env.local</code>.</li><li>Preencha <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.</li><li>Reinicie o servidor de desenvolvimento.</li></ol><p className="auth-note">Nunca use uma chave <code>service_role</code> no navegador.</p></section></main>
}

function AuthGate({client}:{client:SupabaseClient}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  useEffect(() => {
    let active = true
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, next) => {
      if (active) { setSession(next); setLoading(false) }
    })
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return
      if (error) setAuthError(error.message)
      setSession(data.session); setLoading(false)
    }).catch((error: unknown) => { if (active) { setAuthError(error instanceof Error ? error.message : 'Não foi possível verificar sua sessão.'); setLoading(false) } })
    return () => { active = false; subscription.unsubscribe() }
  }, [client])
  async function signOut() {
    const { error } = await client.auth.signOut()
    if (error) setAuthError(error.message)
  }
  if (loading) return <main className="auth-shell"><section className="auth-card" role="status">Verificando conexão e sessão…</section></main>
  if (authError && !session) return <main className="auth-shell"><section className="auth-card"><h1>Não foi possível conectar</h1><p>{authError}</p><button className="button button-light" onClick={() => window.location.reload()}>Tentar novamente</button></section></main>
  return session ? <Workspace client={client} onSignOut={() => { void signOut() }} /> : <AuthForm client={client} />
}

function AuthForm({client}:{client:SupabaseClient}) {
  const [signup, setSignup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('')
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    try {
      if (signup) {
        if (password.length < 8) throw new Error('A senha deve ter pelo menos 8 caracteres.')
        const { data, error } = await client.auth.signUp({ email, password })
        if (error) throw error
        if (!data.session) setMessage('Cadastro iniciado. Confirme seu e-mail para entrar.')
      } else {
        const { error } = await client.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível autenticar. Tente novamente.') }
    finally { setBusy(false) }
  }
  return <main className="auth-shell"><section className="auth-card"><div className="brand auth-brand"><span className="brand-icon"><Wallet size={19}/></span><span>Preço<span className="brand-green">Certo</span></span></div><div className="eyebrow">SEUS DADOS, NA SUA CONTA</div><h1>{signup ? 'Criar conta' : 'Entrar no PreçoCerto'}</h1><p>Os dados só são carregados do seu projeto Supabase depois da autenticação.</p><form onSubmit={(event) => { void submit(event) }}><label className="field-label">E-mail<input type="email" name="email" autoComplete="email" required/></label><label className="field-label">Senha<input type="password" name="password" minLength={8} autoComplete={signup?'new-password':'current-password'} required/></label>{message && <p role="status" className="auth-message">{message}</p>}<button disabled={busy} className="button button-primary auth-submit" type="submit">{busy?'Aguarde…':signup?'Criar conta':'Entrar'}</button></form><button className="auth-switch" onClick={() => {setSignup(!signup);setMessage('')}}>{signup?'Já tem uma conta? Entrar':'Ainda não tem conta? Criar conta'}</button></section></main>
}

function Workspace({client,onSignOut}:{client:SupabaseClient;onSignOut:()=>void}) {
  const [data, setData] = useState<AppData>(emptyData)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [modal, setModal] = useState<'route' | 'price' | null>(null)
  const [editingRoute, setEditingRoute] = useState<RideRoute | null>(null)
  const [notice, setNotice] = useState('')
  const navigate = useNavigate()
  const refresh = useCallback(async () => {
    setLoading(true); setLoadError('')
    try { setData(await loadUserData(client)) }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Não foi possível carregar o banco Supabase.') }
    finally { setLoading(false) }
  }, [client])
  useEffect(() => { void refresh() }, [refresh])
  async function deleteRoute(route: RideRoute) {
    if (!window.confirm(`Excluir a rota “${route.origin} → ${route.destination}” e seus registros?`)) return
    try { await deleteRouteRecord(client, route.id); await refresh(); setNotice('Rota e registros relacionados excluídos do Supabase.') }
    catch (error) { setNotice(error instanceof Error ? `Falha ao excluir rota: ${error.message}` : 'Falha ao excluir rota.') }
  }
  async function deleteObservation(item: Observation) {
    if (!window.confirm('Excluir este registro de preço?')) return
    try { await deleteObservationRecord(client, item.id); await refresh(); setNotice('Registro excluído do Supabase.') }
    catch (error) { setNotice(error instanceof Error ? `Falha ao excluir registro: ${error.message}` : 'Falha ao excluir registro.') }
  }
  function addRoute(input: unknown) {
    let values: ReturnType<typeof routeInputSchema.parse>
    try { values = routeInputSchema.parse(input) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Confira os dados informados.'); return }
    void (async () => {
      if (editingRoute) await updateRouteRecord(client, editingRoute.id, values)
      else await createRoute(client, values)
      await refresh(); setModal(null); setEditingRoute(null); setNotice(editingRoute ? 'Rota atualizada.' : 'Rota cadastrada.')
    })().catch((error: unknown) => { setNotice(error instanceof Error ? `Falha ao salvar rota: ${error.message}` : 'Falha ao salvar rota.') })
  }
  function addObservation(input: unknown) {
    let values: ReturnType<typeof observationInputSchema.parse>
    try { values = observationInputSchema.parse(input) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Confira os dados informados.'); return }
    void createObservation(client, values)
      .then(async () => { await refresh(); setModal(null); setNotice('Preço manual salvo no Supabase.') })
      .catch((error: unknown) => { setNotice(error instanceof Error ? `Falha ao salvar preço: ${error.message}` : 'Falha ao salvar preço.') })
  }
  function downloadCsv() {
    const blob = new Blob([exportCsv(data)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'precocerto-historico.csv'; a.click(); URL.revokeObjectURL(url)
  }
  function downloadBackup() {
    const backup = { format: 'precocerto-backup-v1', exportedAt: new Date().toISOString(), routes: data.routes, observations: data.observations }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'precocerto-backup.json'; a.click(); URL.revokeObjectURL(url)
  }
  async function uploadCsv(file?: File) {
    if (!file) return
    try {
      const imported = importCsv(await file.text(), data)
      const knownObservationIds = new Set(data.observations.map((item) => item.id))
      const routeIds = new Map(imported.routes.filter((route) => !data.routes.some((existing) => existing.id === route.id)).map((route) => [route.id, route]))
      for (const [localId, route] of routeIds) {
        const saved = await createRoute(client, route)
        imported.observations.filter((item) => item.routeId === localId).forEach((item) => { item.routeId = saved.id })
      }
      for (const item of imported.observations.filter((observation) => !knownObservationIds.has(observation.id))) {
        await createObservation(client, { routeId: item.routeId, platform: item.platform, category: item.category, price: item.price, observedAt: item.observedAt })
      }
      await refresh(); setNotice('Histórico manual importado para o Supabase.')
    }
    catch (error) { setNotice(error instanceof Error ? `Falha na importação: ${error.message}` : 'Falha na importação.') }
  }
  async function clearRecords() {
    if (!window.confirm('Apagar todas as suas rotas, observações e previsões salvas? Essa ação não pode ser desfeita.')) return
    try { await clearRideRecords(client); await refresh(); setNotice('Suas rotas e registros foram apagados do Supabase.') }
    catch (error) { setNotice(error instanceof Error ? `Falha ao apagar registros: ${error.message}` : 'Falha ao apagar registros.') }
  }
  if (loading) return <main className="auth-shell"><section className="auth-card" role="status">Carregando seus dados do Supabase…</section></main>
  if (loadError) return <main className="auth-shell"><section className="auth-card"><h1>Não foi possível carregar seus dados</h1><p>{loadError}</p><p>Confirme o projeto e aplique as migrações antes de tentar novamente.</p><div className="form-actions"><button className="button button-light" onClick={onSignOut}>Sair</button><button className="button button-primary" onClick={() => { void refresh() }}>Tentar novamente</button></div></section></main>
  const recent = [...data.observations].sort((a,b) => b.observedAt.localeCompare(a.observedAt)).slice(0,5)
  const realValidObservations = data.observations.filter((item) => item.sourceType !== 'demo' && item.validityStatus === 'valid')
  const average = realValidObservations.length ? realValidObservations.reduce((sum, o) => sum + o.price, 0) / realValidObservations.length : 0
  return <div className="app-shell">
    <aside className="sidebar"><a className="brand" href="/" onClick={(e) => {e.preventDefault(); navigate('/')}}><span className="brand-icon"><Wallet size={19}/></span><span>Preço<span className="brand-green">Certo</span><small>SEU HISTÓRICO DE CORRIDAS</small></span></a><div className="side-label">MENU PRINCIPAL</div><nav className="main-nav" aria-label="Navegação principal"><SideItem to="/" icon={<Home/>} label="Visão geral"/><SideItem to="/rotas" icon={<RouteIcon/>} label="Minhas rotas" count={data.routes.length}/><SideItem to="/historico" icon={<Clock3/>} label="Histórico"/><SideItem to="/previsoes" icon={<ChartNoAxesColumn/>} label="Previsões"/></nav><div className="sidebar-bottom"><div className="privacy-card"><span className="privacy-dot"/><div><b>Seus dados, do seu jeito</b><p>Seus dados são carregados da sua conta Supabase.</p></div></div><button className="nav-button" onClick={downloadBackup}><Settings2 size={18}/> Exportar meus dados (JSON)</button><button className="nav-button danger-nav" onClick={() => { void clearRecords() }}><Trash2 size={18}/> Apagar meus registros</button><button className="nav-button" onClick={onSignOut}>Sair da conta</button><div className="profile"><div className="avatar">PC</div><div><b>Minha conta</b><small>Autenticada via Supabase</small></div></div></div></aside>
    <div className="mobile-top"><a className="brand" href="/" onClick={(e) => {e.preventDefault(); navigate('/')}}><span className="brand-icon"><Wallet size={19}/></span><span>Preço<span className="brand-green">Certo</span></span></a><button aria-label="Registrar preço" className="icon-button" onClick={() => setModal('price')}><Plus/></button></div>
    <div className="main-column"><header className="topbar"><div className="breadcrumb"><span>Seu espaço</span><span className="crumb-separator">/</span><b>{pageNames[pageForPath(location.pathname)]}</b></div><div className="top-actions"><span className="demo-indicator"><span/>DADOS MANUAIS</span><button className="icon-button" aria-label="Notificações"><Bell size={18}/></button><div className="avatar top-avatar">PC</div></div></header>
    <main className="content"><Routes><RouterRoute path="/" element={<Dashboard data={data} average={average} recent={recent} openPrice={() => {setModal('price')}} openRoutes={() => navigate('/rotas')} deleteObservation={deleteObservation}/>}/><RouterRoute path="/rotas" element={<RoutesPage routes={data.routes} observations={data.observations} add={() => {setEditingRoute(null);setModal('route')}} edit={(route) => {setEditingRoute(route);setModal('route')}} remove={deleteRoute} record={(id) => {setModal('price');sessionStorage.setItem('precocerto:selectedRoute', id)}}/>}/><RouterRoute path="/historico" element={<HistoryPage data={data} remove={deleteObservation} download={downloadCsv} upload={uploadCsv}/>}/><RouterRoute path="/previsoes" element={<ForecastPage routes={data.routes} observations={data.observations}/>}/><RouterRoute path="*" element={<Dashboard data={data} average={average} recent={recent} openPrice={() => setModal('price')} openRoutes={() => navigate('/rotas')} deleteObservation={deleteObservation}/>}/></Routes></main></div>
    <nav className="mobile-nav" aria-label="Navegação móvel"><SideItem to="/" icon={<Home/>} label="Início"/><SideItem to="/rotas" icon={<RouteIcon/>} label="Rotas"/><SideItem to="/historico" icon={<Clock3/>} label="Histórico"/><SideItem to="/previsoes" icon={<ChartNoAxesColumn/>} label="Previsões"/></nav>
    {modal && <Modal title={modal === 'route' ? editingRoute ? 'Editar rota' : 'Nova rota' : 'Registrar preço'} close={() => {setModal(null);setEditingRoute(null)}}><form onSubmit={(e) => {e.preventDefault();const form=e.currentTarget;const fd=new FormData(form);try { if(modal==='route') addRoute({origin:fd.get('origin'),destination:fd.get('destination'),category:fd.get('category')}); else addObservation({routeId:fd.get('routeId'),platform:fd.get('platform'),category:fd.get('category'),price:Number(fd.get('price')),observedAt:toFortalezaIso(String(fd.get('observedAt')))}) } catch(error) { setNotice(error instanceof Error ? error.message : 'Confira os dados informados.') } }}>
    {modal==='route' ? <><Field label="Origem" name="origin" placeholder="Ex.: Rua das Flores, 120" defaultValue={editingRoute?.origin} required/><Field label="Destino" name="destination" placeholder="Ex.: Aeroporto de Fortaleza" defaultValue={editingRoute?.destination} required/><Field label="Categoria de corrida (opcional)" name="category" placeholder="Ex.: UberX, Comfort" defaultValue={editingRoute?.category}/></> : <><label className="field-label">Rota<select name="routeId" required defaultValue={sessionStorage.getItem('precocerto:selectedRoute') ?? ''} onChange={() => sessionStorage.removeItem('precocerto:selectedRoute')}><option value="" disabled>Selecione uma rota</option>{data.routes.map((r) => <option key={r.id} value={r.id}>{r.origin} → {r.destination}</option>)}</select></label><label className="field-label">Plataforma<select name="platform"><option>Uber</option><option>99</option></select></label><Field label="Categoria (opcional)" name="category" placeholder="Ex.: UberX"/><Field label="Preço observado (R$)" name="price" type="number" min="0.01" step="0.01" placeholder="0,00" required/><Field label="Data e hora em Fortaleza" name="observedAt" type="datetime-local" defaultValue={toLocalInputNow()} required/><p className="form-note">Registro manual. Os preços não são consultados automaticamente.</p></>}
    <div className="form-actions"><button type="button" className="button button-light" onClick={() => setModal(null)}>Cancelar</button><button className="button button-primary" type="submit">{modal==='route'?'Salvar rota':'Salvar preço'}</button></div></form></Modal>}
    {notice && <div role="status" className="toast"><Check size={17}/>{notice}<button aria-label="Fechar aviso" onClick={() => setNotice('')}><X size={15}/></button></div>}
  </div>
}
function pageForPath(path: string): Page { if(path.startsWith('/rotas'))return 'rotas';if(path.startsWith('/historico'))return 'historico';if(path.startsWith('/previsoes'))return 'previsoes';return 'inicio' }
function sourceLabel(source: Observation['sourceType']): string { return source === 'manual' ? 'Manual' : source === 'authorized_api' ? 'API autorizada' : 'Demonstração' }
function validityLabel(status: Observation['validityStatus']): string { return status === 'valid' ? 'Válido' : status === 'invalid' ? 'Inválido' : 'Revisar' }
function SideItem({to,icon,label,count}:{to:string;icon:React.ReactNode;label:string;count?:number}) { return <NavLink end={to==='/'} to={to} className={({isActive})=>`nav-button ${isActive?'active':''}`}>{icon}<span>{label}</span>{count !== undefined && count>0 && <small>{count}</small>}</NavLink> }
function SectionTitle({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:React.ReactNode}) {return <div className="section-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>}
function Dashboard({data,average,recent,openPrice,openRoutes,deleteObservation}:{data:AppData;average:number;recent:Observation[];openPrice:()=>void;openRoutes:()=>void;deleteObservation:(o:Observation)=>void}) {
 return <><div className="welcome-row"><div><div className="eyebrow">{new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Fortaleza',weekday:'long',day:'2-digit',month:'long'}).format(new Date()).toLocaleUpperCase('pt-BR')}</div><h1>Bom dia 👋</h1><p>Uma visão clara dos seus registros de corrida.</p></div><button className="button button-primary" onClick={openPrice}><Plus size={17}/>Registrar preço</button></div><div className="callout"><div className="callout-icon"><ChartNoAxesColumn size={19}/></div><div><b>Seus registros ajudam você a planejar.</b><p>Adicione observações reais para acompanhar como os preços mudam ao longo do tempo.</p></div><button aria-label="Fechar dica" onClick={(e)=>e.currentTarget.parentElement?.remove()}><X size={16}/></button></div><div className="stats-grid"><Stat icon={<RouteIcon/>} label="Rotas salvas" value={String(data.routes.length).padStart(2,'0')} detail="caminhos cadastrados"/><Stat icon={<Clock3/>} label="Registros" value={String(data.observations.length).padStart(2,'0')} detail="observações manuais"/><Stat icon={<Wallet/>} label="Média registrada" value={average?formatPrice(average):'—'} detail={average?'nos seus registros':'sem dados ainda'}/></div><div className="dashboard-grid"><section className="panel routes-panel"><PanelHeading title="Suas rotas" subtitle="Acompanhe os trajetos que você salvou" action={<button className="text-button" onClick={openRoutes}>Ver todas</button>}/>{data.routes.length===0?<Empty icon={<MapPin/>} title="Nenhuma rota cadastrada" description="Cadastre uma rota para começar a registrar seus preços." action={<button className="button button-primary button-small" onClick={openRoutes}><Plus size={15}/>Adicionar rota</button>}/>:<div className="route-list">{data.routes.slice(0,3).map(r=><div className="route-row" key={r.id}><div className="route-icon"><RouteIcon size={18}/></div><div className="route-label"><b>{r.origin} <span>→</span> {r.destination}</b><small>{r.category||'Categoria não definida'}</small></div><span className="route-count">{data.observations.filter(o=>o.routeId===r.id).length} reg.</span></div>)}</div>}</section><section className="panel recent-panel"><PanelHeading title="Registros recentes" subtitle="Os preços que você anotou por último" action={<span className="manual-pill">MANUAIS</span>}/>{recent.length===0?<Empty icon={<Wallet/>} title="Seu histórico começa aqui" description="Registre um preço observado no app da plataforma." action={<button className="text-button" onClick={openPrice}>Registrar preço <span>→</span></button>}/>:<div className="recent-list">{recent.slice(0,4).map(o=>{const r=data.routes.find(route=>route.id===o.routeId);return <div className="recent-row" key={o.id}><div className="platform-icon">{o.platform==='Uber'?'U':'99'}</div><div className="recent-label"><b>{r?`${r.origin} → ${r.destination}`:'Rota removida'}</b><small>{o.platform} · {sourceLabel(o.sourceType)} · {formatFortaleza(o.observedAt,{dateStyle:'short',timeStyle:'short'})}</small></div><strong>{formatPrice(o.price)}</strong><button aria-label="Excluir registro" className="delete-icon" onClick={()=>deleteObservation(o)}><Trash2 size={15}/></button></div>})}</div>}</section></div><section className="panel trend-panel"><div className="trend-heading"><div><h2>Panorama de preços</h2><p>Seus registros ao longo do tempo</p></div><span className="manual-pill">DADOS PESSOAIS</span></div>{data.observations.length<2?<div className="trend-empty"><div className="trend-chart-icon"><ChartNoAxesColumn size={20}/></div><div><b>Adicione mais registros para ver seu histórico crescer.</b><p>Este painel organiza somente preços que você anotou manualmente.</p></div><span className="legend"><i/>Registros reais</span></div>:<MiniChart observations={data.observations}/>}</section></>
}
function Stat({icon,label,value,detail}:{icon:React.ReactNode;label:string;value:string;detail:string}) {return <div className="stat-card"><div className="stat-top"><span>{label}</span><i>{icon}</i></div><b className="stat-value">{value}</b><small>{detail}</small></div>}
function PanelHeading({title,subtitle,action}:{title:string;subtitle:string;action?:React.ReactNode}){return <div className="panel-heading"><div><h2>{title}</h2><p>{subtitle}</p></div>{action}</div>}
function Empty({icon,title,description,action}:{icon:React.ReactNode;title:string;description:string;action?:React.ReactNode}){return <div className="empty-state"><div className="empty-icon">{icon}</div><b>{title}</b><p>{description}</p>{action}</div>}
function MiniChart({observations}:{observations:Observation[]}){const items=observations.slice(-8);const max=Math.max(...items.map(o=>o.price));return <div className="chart" role="img" aria-label="Gráfico dos últimos preços observados">{items.map((o,i)=><div className="bar-wrap" key={o.id}><span>{formatPrice(o.price)}</span><div className={`bar ${i===items.length-1?'bar-last':''}`} style={{height:`${Math.max(12,o.price/max*100)}%`}}/><small>{formatFortaleza(o.observedAt,{day:'2-digit',month:'2-digit'})}</small></div>)}</div>}
function RoutesPage({routes,observations,add,edit,remove,record}:{routes:RideRoute[];observations:Observation[];add:()=>void;edit:(r:RideRoute)=>void;remove:(r:RideRoute)=>void;record:(id:string)=>void}){return <><SectionTitle eyebrow="ORGANIZE SEUS TRAJETOS" title="Minhas rotas" description="Salve seus caminhos para comparar os registros depois." action={<button className="button button-primary" onClick={add}><Plus size={17}/>Nova rota</button>}/>{routes.length===0?<div className="panel full-empty"><Empty icon={<MapPin/>} title="Comece cadastrando uma rota" description="Adicione origem e destino para registrar preços relacionados a esse trajeto." action={<button className="button button-primary" onClick={add}><Plus size={16}/>Cadastrar rota</button>}/></div>:<div className="route-cards">{routes.map(route=><article className="panel route-card" key={route.id}><div className="route-card-top"><div className="route-icon"><RouteIcon size={18}/></div><span className="route-count">{observations.filter(o=>o.routeId===route.id).length} registros</span><button className="delete-icon" aria-label={`Excluir rota ${route.origin} para ${route.destination}`} onClick={()=>remove(route)}><Trash2 size={16}/></button></div><h2>{route.origin}</h2><div className="destination-line">↓</div><h2>{route.destination}</h2><div className="route-card-foot"><span>{route.category||'Categoria não definida'}</span><button className="text-button" onClick={()=>edit(route)}>Editar</button></div><button className="button button-light record-route" onClick={()=>record(route.id)}><Plus size={15}/>Registrar preço</button></article>)}</div>}</>}
function HistoryPage({data,remove,download,upload}:{data:AppData;remove:(o:Observation)=>void;download:()=>void;upload:(f?:File)=>Promise<void>}){const [routeFilter,setRoute]=useState('');const [platform,setPlatform]=useState('');const [category,setCategory]=useState('');const [period,setPeriod]=useState('');const filtered=useMemo(()=>data.observations.filter(o=>{const cutoff=period?Date.now()-Number(period)*86400000:0;return(!routeFilter||o.routeId===routeFilter)&&(!platform||o.platform===platform)&&(!category||o.category.toLowerCase().includes(category.toLowerCase()))&&(!period||new Date(o.observedAt).getTime()>=cutoff)}).sort((a,b)=>b.observedAt.localeCompare(a.observedAt)),[data,routeFilter,platform,category,period]);return <><SectionTitle eyebrow="ACOMPANHE O QUE VOCÊ OBSERVOU" title="Histórico de preços" description="Seus registros manuais, organizados em um só lugar." action={<div className="button-pair"><label className="button button-light file-button"><ArrowUpFromLine size={16}/>Importar CSV<input type="file" accept=".csv,text/csv" onChange={e=>{void upload(e.target.files?.[0]);e.currentTarget.value=''}}/></label><button className="button button-light" onClick={download}><ArrowDownToLine size={16}/>Exportar</button></div>}/><div className="filters panel"><label><span>Rota</span><select value={routeFilter} onChange={e=>setRoute(e.target.value)}><option value="">Todas as rotas</option>{data.routes.map(r=><option value={r.id} key={r.id}>{r.origin} → {r.destination}</option>)}</select></label><label><span>Plataforma</span><select value={platform} onChange={e=>setPlatform(e.target.value)}><option value="">Todas</option><option>Uber</option><option>99</option></select></label><label><span>Categoria</span><input value={category} onChange={e=>setCategory(e.target.value)} placeholder="Todas"/></label><label><span>Período</span><select value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Todo o período</option><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option></select></label></div><div className="panel history-panel"><div className="history-heading"><div><h2>Observações</h2><p>{filtered.length} {filtered.length===1?'registro encontrado':'registros encontrados'}</p></div><span className="manual-pill">REGISTROS</span></div>{filtered.length===0?<Empty icon={<Search/>} title={data.observations.length?'Nenhum resultado para esses filtros':'Ainda não há registros'} description={data.observations.length?'Ajuste os filtros para ver outras observações.':'Quando você anotar preços, eles aparecerão aqui.'}/>:<div className="table-scroll"><table><thead><tr><th>ROTA</th><th>PLATAFORMA</th><th>CATEGORIA</th><th>ORIGEM DO DADO</th><th>VALIDADE</th><th>DATA E HORA · FORTALEZA</th><th>PREÇO OBSERVADO</th><th></th></tr></thead><tbody>{filtered.map(o=>{const r=data.routes.find(route=>route.id===o.routeId);return <tr key={o.id}><td><b>{r?`${r.origin} → ${r.destination}`:'Rota removida'}</b></td><td><span className="platform-badge">{o.platform==='Uber'?'U':'99'}</span>{o.platform}</td><td>{o.category||'—'}</td><td><span className={`source-badge source-${o.sourceType}`}>{sourceLabel(o.sourceType)}</span></td><td>{validityLabel(o.validityStatus)}</td><td>{formatFortaleza(o.observedAt,{dateStyle:'medium',timeStyle:'short'})}</td><td><b>{formatPrice(o.price)}</b></td><td><button className="delete-icon" aria-label="Excluir registro" onClick={()=>remove(o)}><Trash2 size={15}/></button></td></tr>})}</tbody></table></div>}</div></>}
function ForecastPage({routes,observations}:{routes:RideRoute[];observations:Observation[]}){
 const [routeId,setRouteId]=useState(routes[0]?.id??'')
 useEffect(()=>{if(!routes.some((route)=>route.id===routeId))setRouteId(routes[0]?.id??'')},[routes,routeId])
 const groups=useMemo(()=>calculateForecasts(observations).filter((group)=>group.routeId===routeId),[observations,routeId])
 const selected=routes.find((route)=>route.id===routeId)
 return <><SectionTitle eyebrow="LEITURA DO SEU HISTÓRICO" title="Previsões históricas" description="Padrões calculados exclusivamente a partir dos seus registros válidos."/>
  <section className="panel forecast-controls"><label className="field-label" htmlFor="forecast-route">Rota analisada</label><select id="forecast-route" value={routeId} onChange={(event)=>setRouteId(event.target.value)}><option value="">Selecione uma rota</option>{routes.map((route)=><option key={route.id} value={route.id}>{route.origin} → {route.destination}</option>)}</select></section>
  {!selected?<section className="panel forecast-empty"><Empty icon={<ChartNoAxesColumn/>} title="Cadastre uma rota para começar" description="Depois, registre os preços observados nessa rota ao longo do tempo."/></section>:groups.length===0?<section className="panel forecast-empty"><Empty icon={<ChartNoAxesColumn/>} title="Ainda não há histórico suficiente" description="Registre preços reais para esta rota em diferentes dias e horários. A previsão exige observações manuais ou de fonte autorizada; dados demonstrativos são ignorados."/></section>:<div className="forecast-groups">{groups.map((group)=><ForecastGroupCard group={group} key={`${group.platform}-${group.category}`}/>)}</div>}
  <section className="forecast-banner"><div className="forecast-icon"><ChartNoAxesColumn/></div><div><span className="manual-pill">COMO INTERPRETAR</span><h2>Referência histórica, não cotação</h2><p>Uma previsão descreve preços observados no passado. Ela não consulta o preço atual, não garante o preço futuro e não garante que o horário indicado será mais barato na próxima corrida.</p><p>Uber e 99 permanecem separados: esta versão não possui um mapeamento validado de equivalência entre categorias dos aplicativos para autorizar uma comparação direta.</p></div></section>
  <section className="panel forecast-method"><h2>Critérios de confiança</h2><p>Faixa mínima: 5 registros em 3 dias distintos. Confiança média exige ao menos 10 registros em 6 dias; alta exige 20 em 12 dias, dispersão interquartil até 18% da mediana e observação recente. Dados com mais de 90 dias sem atualização não geram recomendação.</p><div className="confidence-list"><span>Baixa: base pequena ou instável</span><span>Média: ≥10 registros, ≥6 dias e IQR/mediana ≤30%</span><span>Alta: ≥20 registros, ≥12 dias, IQR/mediana ≤18% e atualização em 21 dias</span></div><p>Para cada faixa, a mediana é comparada com o baseline: mediana geral dos últimos 180 dias para a mesma rota, plataforma e categoria. Apenas faixas avaliáveis abaixo desse baseline são destacadas.</p></section>
 </>
}
function ForecastGroupCard({group}:{group:ForecastGroup}){
 return <section className="panel forecast-group"><div className="forecast-group-heading"><div><span className="platform-badge">{group.platform==='Uber'?'U':'99'}</span><h2>{group.platform} · {group.category||'Categoria não informada'}</h2></div><span className={`forecast-state state-${group.status}`}>{group.status==='ready'?'Padrão histórico':group.status==='stale'?'Histórico desatualizado':'Ainda não há histórico suficiente'}</span></div>
 <div className="forecast-stats"><Stat icon={<Clock3/>} label="Observações usadas" value={String(group.sampleCount)} detail={`${group.distinctDays} dias distintos`}/><Stat icon={<Wallet/>} label="Mediana geral · 180 dias" value={group.baselineMedian===null?'—':formatPrice(group.baselineMedian)} detail={group.recentMedian===null?'sem amostra recente de 60 dias':`mediana recente: ${formatPrice(group.recentMedian)}`}/><Stat icon={<ChartNoAxesColumn/>} label="Observação mais recente" value={group.latestAt?formatFortaleza(group.latestAt,{dateStyle:'short'}):'—'} detail={group.latestAt?formatFortaleza(group.latestAt,{timeStyle:'short'}):'sem registros'}/></div>
 {group.status==='ready'?<><p className="forecast-reason">{group.reason}</p><h3>Faixas historicamente abaixo do baseline</h3><div className="recommendation-list">{group.recommendations.map((window)=><Recommendation key={`${window.weekday}-${window.startMinute}`} window={window}/>)}</div></>:<div className="forecast-insufficient" role="status"><b>{group.status==='stale'?'Atualize seus registros':'Ainda não há histórico suficiente'}</b><p>{group.reason} Registre observações em diferentes semanas para permitir uma comparação consistente.</p></div>}
 <h3>Histórico de preços · janela máxima de 180 dias</h3><PriceHistoryChart points={group.chart}/>
 </section>
}
function Recommendation({window}:{window:ForecastWindow}){return <article className="recommendation"><div><b>{formatWindow(window)}</b><span>{window.sampleCount} observações · {window.distinctDays} dias distintos</span></div><strong>{formatPrice(window.median)}<small>mediana histórica</small></strong><div className="recommendation-range"><span>P25 {formatPrice(window.p25)}</span><span>P75 {formatPrice(window.p75)}</span><span>Dispersão {formatPrice(window.iqr)}</span></div><span className={`confidence confidence-${window.confidence}`}>Confiança {window.confidence}</span>{window.recentMedian!==null&&<small className="recent-median">Últimos 60 dias: {formatPrice(window.recentMedian)} ({window.recentSampleCount} amostras)</small>}</article>}
function PriceHistoryChart({points}:{points:ForecastGroup['chart']}){if(!points.length)return <p className="chart-empty">Sem observações para desenhar o gráfico.</p>;const shown=points.slice(-60);const min=Math.min(...shown.map((point)=>point.price));const max=Math.max(...shown.map((point)=>point.price));const spread=max-min||1;const coordinates=shown.map((point,index)=>`${shown.length===1?320:index/(shown.length-1)*640},${150-(point.price-min)/spread*130}`).join(' ');return <div className="forecast-chart-wrap"><svg className="forecast-chart" viewBox="0 0 640 170" role="img" aria-label={`Gráfico com ${shown.length} observações históricas de preços`}><line x1="0" y1="150" x2="640" y2="150" className="chart-axis"/><polyline points={coordinates} className="chart-line" fill="none"/>{shown.map((point,index)=><circle key={`${point.observedAt}-${index}`} cx={shown.length===1?320:index/(shown.length-1)*640} cy={150-(point.price-min)/spread*130} r="3" className="chart-point"><title>{formatFortaleza(point.observedAt,{dateStyle:'short',timeStyle:'short'})}: {formatPrice(point.price)}</title></circle>)}</svg><div className="chart-caption"><span>{formatPrice(min)} · menor registro</span><span>{formatPrice(max)} · maior registro</span><span>{shown.length} de {points.length} pontos</span></div></div>}
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}){return <div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Fechar" onClick={close}><X size={18}/></button></div>{children}</section></div>}
function Field({label,name,placeholder,type='text',defaultValue,min,step,required}:{label:string;name:string;placeholder?:string;type?:string;defaultValue?:string;min?:string;step?:string;required?:boolean}){return <label className="field-label">{label}<input name={name} type={type} placeholder={placeholder} defaultValue={defaultValue} min={min} step={step} required={required}/></label>}
function toLocalInputNow(){return fromFortalezaIso(new Date().toISOString())}

export default App
