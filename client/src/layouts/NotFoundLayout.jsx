import { Outlet } from 'react-router-dom';
import Header from '../components/Header';

const NotFoundLayout = () => {
  return (
    <div className="relative overflow-x-hidden bg-[#F8F5EF] text-[#1F1B17] min-h-screen">
      <Header />
      <main id="main" style={{ paddingTop: 'var(--header-offset)' }}>
        <Outlet />
      </main>
      <footer className="border-t border-[#1F1B17]/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[#1F1B17]/60">
            Drift & Dwells
          </p>
        </div>
      </footer>
    </div>
  );
};

export default NotFoundLayout;
