import { Outlet } from 'react-router-dom';
import Navbar from './modules/Navbar';
import Footer from './modules/Footer';
import ApplicationBanner from './modules/ApplicationBanner';
import './App.css';

function App() {
  return (
    <div className="app-container bg-app">
      <ApplicationBanner />
      <Navbar />
      <div className="app-main mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <Outlet />
      </div>
      <Footer />
    </div>
  );
}

export default App;
