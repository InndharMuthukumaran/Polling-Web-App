import React from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { JoinPage } from './pages/JoinPage';
import { PollPage } from './pages/PollPage';
import { DashboardPage } from './pages/DashboardPage';
import { RosterPage } from './pages/RosterPage';
import { NewPollPage } from './pages/NewPollPage';
import { AdminPollPage } from './pages/AdminPollPage';
import { NotFoundPage } from './pages/NotFoundPage';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/join/:joinCode" element={<JoinPage />} />
        <Route path="/p/:pollId" element={<PollPage />} />
        <Route path="/g/:groupId" element={<DashboardPage />} />
        <Route path="/g/:groupId/roster" element={<RosterPage />} />
        <Route path="/g/:groupId/polls/new" element={<NewPollPage />} />
        <Route path="/g/:groupId/polls/:pollId" element={<AdminPollPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
