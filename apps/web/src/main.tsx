import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import viVN from 'antd/locale/vi_VN';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#c86c3c', borderRadius: 10, fontFamily: '"Segoe UI", sans-serif', colorText: '#182435', colorBgLayout: '#f5f6f8' }, components: { Button: { controlHeight: 39 }, Input: { controlHeight: 40 }, Select: { controlHeight: 40 }, Menu: { itemBorderRadius: 9 } } }}>
      <AntApp><App /></AntApp>
    </ConfigProvider>
  </React.StrictMode>,
);
