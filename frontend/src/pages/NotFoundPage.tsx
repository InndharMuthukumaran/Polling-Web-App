import React from 'react';
import { Link } from 'react-router-dom';
import { Card } from '../components/Card';
import { Button } from '../components/Button';

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen py-12 px-4 flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <Card className="text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 text-neutral-600 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-neutral-900">Page not found</h1>
            <p className="text-sm text-neutral-600">
              The link you followed may be broken or the page may have been moved.
            </p>
          </div>
          <div className="pt-2">
            <Link to="/">
              <Button variant="secondary" fullWidth>
                Back to home
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
};
