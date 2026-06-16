const { app, BrowserWindow, session, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

let backend = null

// 配置文件路径
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')
const CRITICAL_COOKIES = new Set(['DedeUserID', 'SESSDATA'])

app.whenReady().then(async () => {
  startBackendServer();
  createWindow('https://www.bilibili.com');
  await updateSessionCookies()

  session.defaultSession.cookies.on('changed', (event, cookie, cause, removed) => {
    if (!cookie.domain.includes('bilibili.com')) return
    if (!CRITICAL_COOKIES.has(cookie.name)) return
    updateSessionCookies()
  })
});

async function updateSessionCookies(retry = 5) {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: 'https://www.bilibili.com' })
    const cookieDict = Object.fromEntries(cookies.map(c => [c.name, c.value]))
    await fetch('http://localhost:5001/backend/update-cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookies: cookieDict })
    })
  } catch (e) {
    if (retry > 0) {
      setTimeout(() => updateSessionCookies(retry - 1), 1000)
    }
  }
}

// 加载配置
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return config
    }
  } catch (error) {
    console.error('加载配置文件失败:', error)
  }

  return {
    downloadDir: path.join(app.getPath('desktop'))
  }
}

// 保存配置
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
  } catch (error) {
    console.error('保存配置文件失败:', error)
  }
}

// 获取当前配置
let currentConfig = loadConfig()

function startBackendServer() {
  const pythonPath = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const backendPath = path.join(__dirname, 'main.py');
  backend = spawn(pythonPath, [backendPath]);
}

function createWindow(url) {
  const mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.loadURL(url)

  // 监听新窗口创建
  mainWindow.webContents.setWindowOpenHandler((details) => {
    createWindow(details.url)
    return { action: 'deny' }
  })
}

// 修改应用退出事件
app.on('before-quit', async (event) => {
  event.preventDefault()
  spawn('taskkill', ['/pid', backend.pid, '/f', '/t'])
  app.exit()
})

// 处理目录选择请求
ipcMain.handle('select-directory', async () => {
  try {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择下载目录',
      defaultPath: currentConfig.downloadDir
    })

    if (!result.canceled && result.filePaths.length > 0) {
      const selectedPath = result.filePaths[0]

      try {
        currentConfig.downloadDir = selectedPath
        saveConfig(currentConfig)

        return { success: true, path: selectedPath }
      } catch (error) {
        console.error('更新下载目录失败:', error)
        return {
          success: false,
          error: error.message || '更新下载目录失败',
          details: error.toString()
        }
      }
    }

    // 用户取消选择时返回特定状态
    return { success: false, canceled: true }
  } catch (error) {
    console.error('选择目录操作失败:', error)
    return {
      success: false,
      canceled: false,
      error: error.message || '选择目录失败',
      details: error.toString()
    }
  }
})

// 获取当前下载目录
ipcMain.handle('get-current-directory', async () => {
  return currentConfig.downloadDir
})