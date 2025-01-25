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
import FAQ from './components/pages/FAQ.tsx';
import Apply from './components/pages/Apply.tsx';

const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<App />}>
      <Route path="/" element={<Home />} />
      <Route path="/board" element={<Board />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/faq" element={<FAQ />} />
    </Route>
  )
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
)
