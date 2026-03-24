import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { NuqsAdapter } from 'nuqs/adapters/react'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import './i18n'
import App from './App.tsx'

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif',
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NuqsAdapter>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <App />
      </MantineProvider>
    </NuqsAdapter>
  </StrictMode>,
)
