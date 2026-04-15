import type { ContentBlockParam } from '../../services/api/streamTypes.js';
import React from 'react';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js';

// reviewRemote module removed — ultrareview is no longer available
export const call: LocalJSXCommandCall = async (onDone, _context, _args) => {
  onDone('Ultrareview is no longer available (remote review modules removed).', {
    display: 'system'
  });
  return null;
};
