import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ControlShell } from './shell/ControlShell';
import './styles.css';

function App() {
  useEffect(() => {
    const stored = localStorage.getItem('nc-theme');
    document.documentElement.classList.toggle('dark', stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  }, []);
  return <><iframe className="canvas-frame" title="共享画板" src="https://nocoder-canvas.297782.xyz/" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" /><ControlShell /></>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
