import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import { RequireAuth } from './context/AuthContext';
import Admin from './pages/Admin';
import Favorites from './pages/Favorites';
import Gallery from './pages/Gallery';
import Login from './pages/Login';
import Viewer from './pages/Viewer';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/i/:uuid"
        element={
          <RequireAuth>
            <Viewer />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Gallery />} />
        <Route path="/favoritos" element={<Favorites />} />
        <Route path="/admin" element={<Admin />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
