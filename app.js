const { app, BrowserWindow, session, ipcMain, dialog } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

// 后端服务器配置
const BACKEND_URL = 'http://localhost:5001'
let flaskProcess = null

// 配置文件路径
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

// 默认配置
const DEFAULT_CONFIG = {
  downloadDir: path.join(app.getPath('desktop'))
}

app.whenReady()
  .then(() => {
    createWindow();
    startFlaskServer();
  });

// 加载配置
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return { ...DEFAULT_CONFIG, ...config }
    }
  } catch (error) {
    console.error('加载配置文件失败:', error)
  }
  return DEFAULT_CONFIG
}

// 保存配置
function saveConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
    return true
  } catch (error) {
    console.error('保存配置文件失败:', error)
    return false
  }
}

// 获取当前配置
let currentConfig = loadConfig()

// 存储所有窗口的引用
let windows = new Set()

function startFlaskServer() {
  // const pythonPath = path.join(__dirname, '.venv', 'Scripts', 'python.exe');
  const pythonPath = "python";
  const backendPath = path.join(__dirname, 'app.py');
  flaskProcess = spawn(pythonPath, [backendPath]);
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.setMenu(null)
  windows.add(mainWindow)

  // 当窗口关闭时，从集合中移除它
  mainWindow.on('closed', () => {
    windows.delete(mainWindow)
  })

  // 监听新窗口创建
  mainWindow.webContents.setWindowOpenHandler((details) => {
    // 创建新窗口
    const newWindow = createWindow()
    newWindow.loadURL(details.url)
    // 阻止默认行为
    return { action: 'deny' }
  })

  // 加载B站首页
  mainWindow.loadURL('https://www.bilibili.com')
  mainWindow.webContents.openDevTools()

  return mainWindow
}

// 修改应用退出事件
app.on('before-quit', async (event) => {
  event.preventDefault()
  spawn('taskkill', ['/pid', flaskProcess.pid, '/f', '/t'])
  app.exit()
})

// 添加超时控制的 fetch
async function fetchWithTimeout(url, options, timeout = 5000) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    return response
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

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
      console.log('the selected path is:', selectedPath)

      try {

        // 更新配置
        currentConfig.downloadDir = selectedPath
        saveConfig(currentConfig)

        // 通知Python后端更新下载目录
        const response = await fetchWithTimeout(`${BACKEND_URL}/backend/update-download-dir`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ path: selectedPath })
        }, 5000)  // 5秒超时

        if (!response.ok) {
          const errorData = await response.json()
          throw new Error(errorData.error || '后端更新下载目录失败')
        }

        const data = await response.json()
        console.log('后端返回的下载目录信息:', data)
        return { success: true, path: data.path }
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
  try {
    // 从后端获取当前下载目录
    const response = await fetch(`${BACKEND_URL}/backend/get-current-directory`)
    const data = await response.json()
    if (response.ok && data.path) {
      // 更新本地配置
      currentConfig.downloadDir = data.path
      saveConfig(currentConfig)
      return data.path
    }
    return currentConfig.downloadDir
  } catch (error) {
    console.error('获取下载目录失败:', error)
    return currentConfig.downloadDir
  }
})

// 添加获取 cookies 的处理
ipcMain.handle('get-cookies', async (event, url) => {
  return await session.defaultSession.cookies.get({ url })
})