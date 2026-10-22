import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import App from '../ui/App'

function mount(path = '/') { return render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>) }
describe('PreçoCerto', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear() })
  it('cadastra uma rota', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(screen.getByRole('button',{name:'Nova rota'})); await user.type(screen.getByLabelText('Origem'),'Aldeota, Fortaleza'); await user.type(screen.getByLabelText('Destino'),'Aeroporto de Fortaleza'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); expect(await screen.findByText('Aldeota, Fortaleza')).toBeInTheDocument(); expect(screen.getByText('Aeroporto de Fortaleza')).toBeInTheDocument()
  })
  it('registra preço manual para rota cadastrada', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(screen.getAllByRole('button',{name:'Nova rota'})[0]!); await user.type(screen.getByLabelText('Origem'),'Centro'); await user.type(screen.getByLabelText('Destino'),'Aeroporto'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); await user.click(screen.getAllByRole('button',{name:'Registrar preço'})[1]!); await user.selectOptions(screen.getByLabelText('Plataforma'),'99'); await user.type(screen.getByLabelText('Preço observado (R$)'),'21.50'); await user.click(screen.getByRole('button',{name:'Salvar preço'})); expect(await screen.findByText('Preço registrado.')).toBeInTheDocument(); expect(JSON.parse(localStorage.getItem('precocerto:v1')!).observations).toHaveLength(1)
  })
  it('exibe validação em formulário de rota', async () => {
    const user = userEvent.setup(); mount('/rotas'); await user.click(screen.getAllByRole('button',{name:'Nova rota'})[0]!); await user.type(screen.getByLabelText('Origem'),'x'); await user.type(screen.getByLabelText('Destino'),'Aeroporto'); await user.click(screen.getByRole('button',{name:'Salvar rota'})); expect(await screen.findByText(/mínimo de 3 caracteres/i)).toBeInTheDocument()
  })
})
