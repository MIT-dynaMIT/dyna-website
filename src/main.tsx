import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './components/App'

import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider
} from 'react-router-dom';

import Home from './components/pages/Home.tsx';
import Board from './components/pages/Board.tsx';
import Apply from './components/pages/Apply.tsx';
import NotFound from './components/pages/NotFound.tsx';
import CoupApp from './components/coup/CoupApp.tsx';

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route element={<App />} errorElement={<NotFound />}>
        <Route path="/" element={<Home />} />
        <Route path="/board" element={<Board />} />
        <Route path="/apply" element={<Apply />} />
      </Route>
      {/* dynaCOUP camp app — its own full-screen world, no site chrome */}
      <Route path="/coup/*" element={<CoupApp />} />
    </>
  )
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
      <RouterProvider router={router} />
  </StrictMode>
)
