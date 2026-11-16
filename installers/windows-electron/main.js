const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

const ERP_APP_URL = 'https://ais-pre-s6qa6hvrevf4hczczfu5o3-555583507010.asia-east1.run.app';

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'Dolphin Road Carriers ERP',
    icon: path.join(__dirname, '../../public/favicon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#F8FAFC',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadURL(ERP_APP_URL);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
