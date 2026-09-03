import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  createShopPrintJob,
  getShopPrinters,
  getShopPublicInfo,
  startCustomerSession,
  uploadPdfAsCustomer,
} from '../api';
import PrintTest from './PrintTest';

/**
 * What a customer lands on after scanning a shop's QR code (spec section
 * 7/83) - no login, no app install. Validates the QR's token against the
 * shop before ever creating a session, so an expired/regenerated QR fails
 * here with a clear message instead of quietly issuing a session anyway.
 */
export default function CustomerPrintPage() {
  const { shopId } = useParams();
  const [searchParams] = useSearchParams();
  const qrToken = searchParams.get('t');
  const [state, setState] = useState('loading'); // loading | ready | error
  const [shopName, setShopName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (!qrToken) {
        setError('This link is missing its QR code - please scan the shop QR code again.');
        setState('error');
        return;
      }
      try {
        const info = await getShopPublicInfo(shopId, qrToken);
        if (cancelled) return;
        await startCustomerSession(shopId, qrToken);
        if (cancelled) return;
        setShopName(info.shopName);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err.response?.data?.error || 'This shop could not be found. Please scan the QR code again.');
        setState('error');
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, [shopId, qrToken]);

  if (state === 'loading') {
    return (
      <div className="card">
        <h1>REMOTE PRINT</h1>
        <div className="hint">Connecting to shop...</div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="card">
        <h1>REMOTE PRINT</h1>
        <div className="hint error">{error}</div>
      </div>
    );
  }

  return (
    <PrintTest
      title={shopName}
      subtitle="Upload your PDF and select print options."
      fetchPrinters={() => getShopPrinters(shopId)}
      uploadFile={uploadPdfAsCustomer}
      submitJob={createShopPrintJob}
      allowSamplePdf={false}
      showFooterLinks={false}
    />
  );
}
