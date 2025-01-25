import { Outlet } from 'react-router-dom';
import Navbar from './modules/Navbar';
import Footer from './modules/Footer';
import './App.css';

function App() {
  return (
    <div className="app-container">
        <Navbar />
        <div className="app-main mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Outlet />
        </div>
        <Footer />
    </div>
  );
}

export default App;
