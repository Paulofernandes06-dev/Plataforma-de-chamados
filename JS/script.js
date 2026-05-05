// ============================================================
//   PLATAFORMA HBP — script.js
//   Integração com Supabase | Abertura, Painel e Status
//   Desenvolvido para: PAULO JOSÉ ALMEIDA FERNANDES JÚNIOR
// ============================================================

// ============================================================
// 1. INICIALIZAÇÃO DO SUPABASE
// ============================================================

const SUPABASE_URL = 'https://yzhuzcuvyveubovwkzkm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_79IJRXEk4J-JwxTXbPDgqw_YTsBssED';

// Carrega o cliente Supabase via CDN (deve ser incluído no HTML antes deste script)
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================
// 2. ROTEADOR DE PÁGINAS
//    Detecta em qual página o usuário está e chama a função correta
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    const pagina = window.location.pathname;

    if (pagina.includes('index') || pagina.endsWith('/') || pagina.endsWith('.html') && document.getElementById('form-chamado')) {
        iniciarPaginaAbertura();
    }

    if (pagina.includes('painel') || document.getElementById('corpo-tabela-tecnico')) {
        iniciarPaginaTecnico();
    }

    if (pagina.includes('status') || document.getElementById('corpo-tabela-status')) {
        iniciarPaginaStatus();
    }
});

// ============================================================
// 3. PÁGINA DE ABERTURA (index.html)
//    Salva o chamado no banco e gera link de WhatsApp
// ============================================================

function iniciarPaginaAbertura() {
    const form = document.getElementById('form-chamado');
    if (!form) return;

    form.addEventListener('submit', async (evento) => {
        evento.preventDefault();

        // Captura os valores do formulário
        const setor      = document.getElementById('setor').value;
        const categoria  = document.getElementById('categoria').value;
        const prioridade = document.querySelector('input[name="prioridade"]:checked').value;
        const descricao  = document.getElementById('descricao').value.trim();

        // Validação básica
        if (!setor || !categoria || !prioridade || !descricao) {
            alert('⚠️ Preencha todos os campos antes de abrir o chamado.');
            return;
        }

        // Desabilita o botão para evitar duplo envio
        const btnEnviar = form.querySelector('.btn-enviar');
        btnEnviar.disabled = true;
        btnEnviar.textContent = 'Enviando...';

        try {
            // Insere o chamado no Supabase
            const { data, error } = await db
                .from('chamados')
                .insert([{
                    setor:      setor,
                    categoria:  categoria,
                    prioridade: prioridade,
                    descricao:  descricao,
                    status:     'Pendente'
                }])
                .select();

            if (error) throw error;

            // Chamado salvo com sucesso
            alert(`✅ Chamado aberto com sucesso!\n\nSetor: ${setor}\nProblema: ${descricao}\n\nUm técnico será acionado em breve.`);

            // Gera e abre o link de WhatsApp para notificação
            const mensagemWpp = encodeURIComponent(
                `🚨 Novo Chamado HBP!\nSetor: ${setor} | Problema: ${descricao}`
            );
            const linkWpp = `https://wa.me/5534992191846?text=${mensagemWpp}`;
            window.open(linkWpp, '_blank');

            // Limpa o formulário após o envio
            form.reset();

        } catch (erro) {
            console.error('Erro ao salvar chamado:', erro);
            alert(`❌ Erro ao abrir o chamado:\n${erro.message || 'Verifique sua conexão e tente novamente.'}`);
        } finally {
            // Reabilita o botão independentemente do resultado
            btnEnviar.disabled = false;
            btnEnviar.textContent = 'ABRIR CHAMADO';
        }
    });
}

// ============================================================
// 4. PÁGINA DO TÉCNICO (painel.html)
//    Lista chamados ativos e permite atualizar o status
// ============================================================

async function iniciarPaginaTecnico() {
    const corpoTabela = document.getElementById('corpo-tabela-tecnico');
    if (!corpoTabela) return;

    await carregarChamadosTecnico();

    // Atualização em tempo real via Supabase Realtime
    db.channel('chamados-painel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, () => {
            carregarChamadosTecnico();
        })
        .subscribe();
}

async function carregarChamadosTecnico() {
    const corpoTabela = document.getElementById('corpo-tabela-tecnico');
    corpoTabela.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#999;">Carregando chamados...</td></tr>';

    try {
        const { data: chamados, error } = await db
            .from('chamados')
            .select('*')
            .neq('status', 'Concluído') // Oculta chamados já finalizados
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!chamados || chamados.length === 0) {
            corpoTabela.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#28a745;padding:20px;">✅ Nenhum chamado pendente no momento.</td></tr>';
            return;
        }

        corpoTabela.innerHTML = ''; // Limpa antes de preencher

        chamados.forEach(chamado => {
            const linha = document.createElement('tr');

            // Formata a hora para exibição (ex: 14:35)
            const hora = new Date(chamado.created_at).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });

            // Define a classe CSS de acordo com a prioridade
            const classePrioridade = chamado.prioridade === 'alta' ? 'alta' :
                                     chamado.prioridade === 'media' ? 'media' : 'baixa';

            // Define a classe CSS de acordo com o status
            const classeStatus = chamado.status === 'Em Andamento' ? 'andamento' : 'pendente';

            // Controla quais botões exibir conforme o status
            const botoes = `
                <div class="acoes">
                    ${chamado.status === 'Pendente' ? `
                        <button class="btn-atender" onclick="atualizarStatus(${chamado.id}, 'Em Andamento')">
                            Atender
                        </button>
                    ` : ''}
                    ${chamado.status !== 'Concluído' ? `
                        <button class="btn-concluir" onclick="atualizarStatus(${chamado.id}, 'Concluído')">
                            Concluir
                        </button>
                    ` : ''}
                </div>
            `;

            linha.innerHTML = `
                <td>#${chamado.id}</td>
                <td>${hora}</td>
                <td>${chamado.setor}</td>
                <td><span class="badge ${classePrioridade}">${capitalizar(chamado.prioridade)}</span></td>
                <td><span class="flag ${classeStatus}">${chamado.status}</span></td>
                <td>${botoes}</td>
            `;

            corpoTabela.appendChild(linha);
        });

    } catch (erro) {
        console.error('Erro ao carregar chamados (painel):', erro);
        corpoTabela.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">❌ Erro ao carregar chamados: ${erro.message}</td></tr>`;
    }
}

// Atualiza o status de um chamado (Atender / Concluir)
async function atualizarStatus(id, novoStatus) {
    try {
        const { error } = await db
            .from('chamados')
            .update({ status: novoStatus })
            .eq('id', id);

        if (error) throw error;

        // Recarrega a tabela após a atualização
        await carregarChamadosTecnico();

    } catch (erro) {
        console.error(`Erro ao atualizar chamado #${id}:`, erro);
        alert(`❌ Não foi possível atualizar o chamado:\n${erro.message}`);
    }
}

// ============================================================
// 5. PÁGINA DE STATUS (status.html)
//    Exibe todos os chamados em tempo real para acompanhamento
// ============================================================

async function iniciarPaginaStatus() {
    const corpoTabela = document.getElementById('corpo-tabela-status');
    if (!corpoTabela) return;

    await carregarChamadosStatus();

    // Atualização em tempo real via Supabase Realtime
    db.channel('chamados-status')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, () => {
            carregarChamadosStatus();
        })
        .subscribe();
}

async function carregarChamadosStatus() {
    const corpoTabela = document.getElementById('corpo-tabela-status');
    corpoTabela.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;">Carregando...</td></tr>';

    try {
        const { data: chamados, error } = await db
            .from('chamados')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!chamados || chamados.length === 0) {
            corpoTabela.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#999;padding:20px;">Nenhum chamado registrado ainda.</td></tr>';
            return;
        }

        corpoTabela.innerHTML = '';

        chamados.forEach(chamado => {
            const linha = document.createElement('tr');

            const hora = new Date(chamado.created_at).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit'
            });

            const classePrioridade = chamado.prioridade === 'alta' ? 'alta' :
                                     chamado.prioridade === 'media' ? 'media' : 'baixa';

            const classeStatus = chamado.status === 'Em Andamento' ? 'andamento' :
                                  chamado.status === 'Concluído'    ? 'concluido' : 'pendente';

            linha.innerHTML = `
                <td>${chamado.setor}</td>
                <td>${hora}</td>
                <td><span class="badge ${classePrioridade}">${capitalizar(chamado.prioridade)}</span></td>
                <td><span class="flag ${classeStatus}">${chamado.status}</span></td>
            `;

            corpoTabela.appendChild(linha);
        });

    } catch (erro) {
        console.error('Erro ao carregar status dos chamados:', erro);
        corpoTabela.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;">❌ Erro ao carregar dados: ${erro.message}</td></tr>`;
    }
}

// ============================================================
// 6. UTILITÁRIOS
// ============================================================

// Capitaliza a primeira letra de uma string
function capitalizar(texto) {
    if (!texto) return '';
    return texto.charAt(0).toUpperCase() + texto.slice(1);
}
