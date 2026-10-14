import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { WorkflowProvider } from './lib/workflows'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkflowProvider><App /></WorkflowProvider>
  </StrictMode>,
)
