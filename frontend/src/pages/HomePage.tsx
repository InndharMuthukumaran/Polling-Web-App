import React from 'react';
import { Card } from '../components/Card';

export const HomePage: React.FC = () => {
  return (
    <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <Card className="text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 text-white flex items-center justify-center mx-auto shadow-md">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Polling App</h1>
            <p className="text-sm text-neutral-600 leading-relaxed">
              Creator tools are coming soon. If you have a poll link, open it.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
};
