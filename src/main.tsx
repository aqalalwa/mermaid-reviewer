import React from 'react';
import ReactDOM from 'react-dom/client';
import { MermaidDiffApp } from './components/MermaidDiffApp';
import './styles.css';

const urlParams = new URLSearchParams(window.location.search);
const defaultViewParam = urlParams.get('defaultView');
const defaultView =
  defaultViewParam === 'split' || defaultViewParam === 'overlay' || defaultViewParam === 'source'
    ? defaultViewParam
    : 'split';

const syncPanZoom = urlParams.has('syncPanZoom') ? urlParams.get('syncPanZoom') !== 'false' : true;
const dimUnchanged = urlParams.has('dimUnchanged') ? urlParams.get('dimUnchanged') === 'true' : false;
const adoDemoOnLoad = urlParams.has('adoDemoOnLoad') ? urlParams.get('adoDemoOnLoad') === 'true' : false;
const ssoClientId = urlParams.get('ssoClientId') || import.meta.env.VITE_ADO_SSO_CLIENT_ID || '';
const ssoTenantId = urlParams.get('ssoTenantId') || import.meta.env.VITE_ADO_SSO_TENANT_ID || 'organizations';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MermaidDiffApp
      defaultView={defaultView}
      syncPanZoom={syncPanZoom}
      dimUnchanged={dimUnchanged}
      adoDemoOnLoad={adoDemoOnLoad}
      ssoClientId={ssoClientId}
      ssoTenantId={ssoTenantId}
    />
  </React.StrictMode>
);
