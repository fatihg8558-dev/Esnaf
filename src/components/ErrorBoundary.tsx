import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Beklenmeyen bir hata oluştu.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Uygulama Hatası:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendlyText = this.state.message;
      if (this.state.message.includes('Missing or insufficient permissions')) {
        friendlyText = 'Bu işlem için veritabanı erişim yetkiniz bulunmuyor veya oturumunuz sona erdi.';
      }

      return (
        <div className="min-h-screen bg-[#0B1120] text-[#F8FAFC] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#131C2E] border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h2 className="text-lg font-semibold">Bir Sorun Oluştu</h2>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">{friendlyText}</p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
