'use client';

import React, { useEffect, useState } from 'react';

// Ported from oc-platform's TimeSince: a monospace MM:SS counter shown while a
// generation is in flight, so the user has live feedback during long async runs.
export function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  return (
    <span className="font-mono text-sm text-gray-400 tabular-nums">
      {mm}:{ss}
    </span>
  );
}
