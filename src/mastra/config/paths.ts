import path from 'path';
import fs from 'fs';

export const DATA_PATH = process.env.DATA_PATH || path.resolve('./data');
export const WORKSPACE_PATH = path.join(DATA_PATH, 'workspace');
export const CONFIG_PATH = path.join(DATA_PATH, 'config');
export const APPS_PATH = path.join(WORKSPACE_PATH, 'apps');

// Ensure necessary directories exist
fs.mkdirSync(WORKSPACE_PATH, { recursive: true });
fs.mkdirSync(CONFIG_PATH, { recursive: true });
fs.mkdirSync(APPS_PATH, { recursive: true });
