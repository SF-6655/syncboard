import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Landing from './pages/Landing'
import Room from './pages/Room'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
      <Route path="/room/:code" element={<Room />} />
      </Routes>
    </BrowserRouter>
  )
}