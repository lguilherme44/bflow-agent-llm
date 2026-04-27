# Arquitetura do bflowbarber-app

O **bflowbarber-app** é um SaaS de gestão para barbearias construído com tecnologias modernas, focado em performance, escalabilidade e experiência do usuário em tempo real.

## 🛠️ Stack Tecnológica Core

- **Frontend**: React 18+ com TypeScript.
- **Build Tool**: Vite (otimizado para desenvolvimento rápido e builds leves).
- **UI Framework**: [Mantine UI](https://mantine.dev/) (biblioteca de componentes robusta e acessível).
- **Ícones**: Tabler Icons.
- **Gerenciamento de Estado**:
  - **Server State**: [TanStack Query (React Query)](https://tanstack.com/query/latest) para cache, sincronização e paginação infinita.
  - **Global State**: React Context API para Autenticação, Temas e Agendamentos.

## 🏗️ Estrutura de Pastas e Responsabilidades

- `src/pages/`: Módulos principais da aplicação (Dashboard, Clientes, Agendamentos, Chat, Web Chat).
- `src/components/`: Componentes reutilizáveis (Layout, Sidebar, Modais, Wrappers de Tema).
- `src/contexts/`: Lógica global (Auth, Theme, Appointment).
- `src/services/`: Configuração do cliente API (Axios) e interceptores.
- `src/types/`: Definições de tipos TypeScript para toda a aplicação.
- `src/utils/`: Utilitários (formatação de datas, validação de permissões).
- `src/help/`: Central de ajuda integrada com guias específicos por tela.

## 💬 Módulo de Comunicação (Chat & Web Chat)

A arquitetura de chat é dividida em dois grandes pilares:
1. **WhatsApp Chat (`/chat`)**: Integração para gerenciar conversas vindas do WhatsApp.
2. **Web Chat (`/web-chat`)**: Console proprietário para atender visitantes do site/widget em tempo real.
   - **Tecnologia**: Utiliza **Socket.io** para comunicação bi-direcional em tempo real.
   - **Funcionalidades**: Presença online, histórico persistente, paginação infinita de mensagens e suporte a componentes interativos (botões/listas).

## 🔐 Segurança e Acessos

- **Rotas Protegidas**: Uso de HOCs (`PrivateRoute`, `RequireAuth`) para garantir autenticação.
- **RBAC (Role Based Access Control)**: Sistema de permissões granulado (`RequirePermission`) que valida as capacidades do usuário.
- **Feature Flags**: Controle dinâmico de funcionalidades (`RequireFeature`) baseado no plano ou configuração do Workspace (Tenant).

## 🚀 Observações de Performance

- **Code Splitting**: Rotas carregadas sob demanda.
- **Caching**: React Query minimiza chamadas redundantes à API.
- **SEO**: Gerenciador de metatags dinâmico (`SeoManager`) integrado às rotas.

---
*Documento gerado automaticamente para fins de análise técnica.*
