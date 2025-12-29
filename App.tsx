import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PointCloudVis from './index';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PointCloudVis />} />
        <Route path="*" element={<PointCloudVis />} />
      </Routes>
    </BrowserRouter>
  );
};

// 挂载应用
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

export default App;

