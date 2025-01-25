import { Outlet } from 'react-router-dom';
import Navbar from './modules/Navbar';
import Footer from './modules/Footer';

function App() {
  return (
    <div className="min-h-screen bg-white flex flex-col">
        <Navbar />
        <main className="flex-grow">
        <Outlet />
        </main>
        <Footer />
    </div>
  );
}

export default App;
