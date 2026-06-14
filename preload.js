const { contextBridge, ipcRenderer } = require('electron')

let socket = null

// 添加一个变量存储预加载的清晰度列表
let cachedQualities = null

// 添加预加载状态变量
let isQualityLoading = false
let qualityLoadPromise = null

const BACKEND_URL = 'http://localhost:5001'

// 改进预加载函数
async function preloadQualities() {
  // 如果已经在加载中，返回现有的 Promise
  if (isQualityLoading && qualityLoadPromise) {
    return qualityLoadPromise
  }

  isQualityLoading = true
  qualityLoadPromise = (async () => {
    try {
      const url = window.location.href
      const cookie = await getCookies()

      const response = await fetch(`${BACKEND_URL}/backend/get-video-qualities`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url, cookie })
      })

      if (!response.ok) {
        throw new Error('预加载清晰度失败')
      }

      const result = await response.json()
      cachedQualities = result.qualities
      console.log('清晰度列表预加载成功')
      return result.qualities
    } catch (error) {
      console.error('预加载清晰度失败:', error)
      cachedQualities = null
      throw error
    } finally {
      isQualityLoading = false
      qualityLoadPromise = null
    }
  })()

  return qualityLoadPromise
}

async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
      resolve(socket)
      return
    }

    socket = new WebSocket('ws://localhost:5001/ws')

    socket.onopen = () => {
      console.log('WebSocket已连接')
      resolve(socket)
    }

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data)
      console.log('收到下载进度:', data)
      window.dispatchEvent(new CustomEvent('download_progress', { detail: data }))
    }

    socket.onerror = (err) => {
      console.error('WebSocket错误:', err)
      reject(err)
    }

    socket.onclose = () => {
      console.log('WebSocket已断开')
      socket = null
    }
  })
}

// 定义要暴露的API
const electronAPI = {
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  getCurrentDirectory: () => ipcRenderer.invoke('get-current-directory'),
}

// 暴露API到渲染进程
try {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI)
  console.log('API 已成功暴露到渲染进程')
} catch (error) {
  console.error('API 暴露失败:', error)
}

// 添加获取 cookie 的辅助函数
async function getCookies() {
  const cookies = await ipcRenderer.invoke('get-cookies', 'https://www.bilibili.com')
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

// 创建设置面板
function createSettingsPanel() {
  const panel = document.createElement('div')
  panel.className = 'settings-panel'
  panel.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    padding: 16px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    display: none;
    z-index: 1000;
    min-width: 280px;
  `

  // 添加标题
  const title = document.createElement('div')
  title.style.cssText = `
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 16px;
    color: #333;
  `
  title.textContent = '下载设置'
  panel.appendChild(title)

  // 添加目录选择区域
  const dirSection = document.createElement('div')
  dirSection.style.cssText = `
    margin-bottom: 16px;
  `

  const dirLabel = document.createElement('div')
  dirLabel.style.cssText = `
    font-size: 13px;
    color: #666;
    margin-bottom: 8px;
  `
  dirLabel.textContent = '下载目录'
  dirSection.appendChild(dirLabel)

  const dirDisplay = document.createElement('div')
  dirDisplay.style.cssText = `
    font-size: 12px;
    color: #333;
    padding: 8px;
    background: #f8f8f8;
    border-radius: 4px;
    margin-bottom: 8px;
    word-break: break-all;
    max-width: 100%;
  `
  dirSection.appendChild(dirDisplay)

  const dirButton = document.createElement('button')
  dirButton.style.cssText = `
    font-size: 12px;
    color: #fff;
    background: #00aeec;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    cursor: pointer;
    transition: all 0.2s ease;
  `
  dirButton.textContent = '选择目录'
  dirButton.onmouseover = () => dirButton.style.background = '#33c2ff'
  dirButton.onmouseout = () => dirButton.style.background = '#00aeec'
  dirSection.appendChild(dirButton)

  // 更新当前目录显示
  async function updateCurrentDir() {
    try {
      const currentDir = await electronAPI.getCurrentDirectory()
      console.log('获取到的当前下载目录:', currentDir)
      dirDisplay.textContent = currentDir || '默认下载目录'
    } catch (error) {
      console.error('获取下载目录失败:', error)
      dirDisplay.textContent = '获取目录失败'
    }
  }

  // 初始化显示当前目录
  updateCurrentDir()

  // 添加目录选择事件
  dirButton.onclick = async () => {
    try {
      const result = await electronAPI.selectDirectory()

      if (result.success) {
        dirDisplay.textContent = result.path
        // 立即更新显示
        await updateCurrentDir()
      } else if (!result.canceled) {  // 只在非取消情况下显示错误
        console.error('选择目录失败:', result.error, result.details)
        dirDisplay.textContent = result.error || '目录设置失败'

        // 显示错误提示
        statusText.style.display = 'block'
        statusText.textContent = '设置下载目录失败，请重试'
        statusText.style.background = 'rgba(255, 0, 0, 0.8)'
        setTimeout(() => {
          statusText.style.display = 'none'
        }, 3000)
      }
    } catch (error) {
      console.error('目录选择操作失败:', error)
      dirDisplay.textContent = '操作失败'
    }
  }

  panel.appendChild(dirSection)
  return panel
}

// 下载按钮组的创建函数
function createDownloadButtons() {
  const buttonGroup = document.createElement('div')
  buttonGroup.style.cssText = `
    display: flex;
    gap: 8px;
    align-items: center;
  `

  // 音频下载按钮
  const audioBtn = document.createElement('div')
  audioBtn.className = 'download-btn audio-download-btn'
  audioBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    padding: 8px 12px;
    background: #00aeec;
    color: #fff;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.2s ease;
    user-select: none;
    white-space: nowrap;
  `

  // 音频图标
  const audioIcon = document.createElement('span')
  audioIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.5a1 1 0 0 1-.67-.26l-5-4.5 1.34-1.48L12 13.15l4.33-3.9 1.34 1.49-5 4.5a1 1 0 0 1-.67.26z"/><path d="M12 15.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 2 0v9a1 1 0 0 1-1 1z"/><path d="M19 20H5a1 1 0 0 1 0-2h14a1 1 0 0 1 0 2z"/></svg>'
  audioIcon.style.marginRight = '4px'
  audioBtn.appendChild(audioIcon)
  audioBtn.appendChild(document.createTextNode('下载音频'))

  // 视频下载按钮
  const videoBtn = document.createElement('div')
  videoBtn.className = 'download-btn video-download-btn'
  videoBtn.style.cssText = audioBtn.style.cssText
  videoBtn.style.background = '#ff6b6b'

  // 视频图标
  const videoIcon = document.createElement('span')
  videoIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M21 7.15a1.7 1.7 0 0 0-1.85.3l-2.15 2V8a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3v8a3 3 0 0 0 3 3h9a3 3 0 0 0 3-3v-1.45l2.15 2a1.7 1.7 0 0 0 1.85.3 1.6 1.6 0 0 0 1-1.5V8.65a1.6 1.6 0 0 0-1-1.5zM15 16a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1z"/></svg>'
  videoIcon.style.marginRight = '4px'
  videoBtn.appendChild(videoIcon)
  videoBtn.appendChild(document.createTextNode('下载视频'))

  // 添加按钮悬停效果
  const buttons = [audioBtn, videoBtn]
  const hoverColors = {
    audioBtn: '#33c2ff',
    videoBtn: '#ff8f8f'
  }

  buttons.forEach(btn => {
    btn.onmouseover = () => {
      if (btn === audioBtn) btn.style.background = hoverColors.audioBtn
      else if (btn === videoBtn) btn.style.background = hoverColors.videoBtn
    }
    btn.onmouseout = () => {
      if (btn === audioBtn) btn.style.background = '#00aeec'
      else if (btn === videoBtn) btn.style.background = '#ff6b6b'
    }
  })

  // 添加设置按钮（齿轮图标）
  const settingsBtn = document.createElement('div')
  settingsBtn.className = 'settings-btn'
  settingsBtn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: #f4f4f4;
    color: #666;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s ease;
  `

  // 设置图标
  settingsBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15.5A3.5 3.5 0 1 1 15.5 12 3.5 3.5 0 0 1 12 15.5zm0-5A1.5 1.5 0 1 0 13.5 12 1.5 1.5 0 0 0 12 10.5z"/><path d="M21.32 9.55L19.2 8.6a1 1 0 0 1-.6-1.2L19.28 5a.92.92 0 0 0-.4-1.1l-1.85-1.1a1 1 0 0 0-1.15.1l-1.7 1.5a1 1 0 0 1-1.3 0L11.18 3a1 1 0 0 0-1.15-.1L8.18 4a.92.92 0 0 0-.4 1.1l.7 2.4a1 1 0 0 1-.6 1.2L5.7 9.55a.86.86 0 0 0-.6 1v2.2a.86.86 0 0 0 .6 1l2.12.95a1 1 0 0 1 .6 1.2L7.72 18.4a.92.92 0 0 0 .4 1.1l1.85 1.1a1 1 0 0 0 1.15-.1l1.7-1.5a1 1 0 0 1 1.3 0l1.7 1.5a1 1 0 0 0 1.15.1l1.85-1.1a.92.92 0 0 0 .4-1.1l-.7-2.4a1 1 0 0 1 .6-1.2l2.12-.95a.86.86 0 0 0 .6-1v-2.2a.86.86 0 0 0-.6-1zM12 16.5a4.5 4.5 0 1 1 4.5-4.5 4.5 4.5 0 0 1-4.5 4.5z"/></svg>'

  // 创建设置面板
  const settingsPanel = createSettingsPanel()
  settingsPanel.style.cssText = `
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 8px;
    padding: 16px;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    display: none;
    z-index: 1000;
    min-width: 280px;
  `

  // 设置按钮点击事件
  let isPanelOpen = false
  settingsBtn.onclick = (e) => {
    e.stopPropagation()
    isPanelOpen = !isPanelOpen
    settingsPanel.style.display = isPanelOpen ? 'block' : 'none'
    settingsBtn.style.background = isPanelOpen ? '#e4e4e4' : '#f4f4f4'
  }

  // 点击外部关闭设置面板
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
      isPanelOpen = false
      settingsPanel.style.display = 'none'
      settingsBtn.style.background = '#f4f4f4'
    }
  })

  // 添加设置按钮悬停效果
  settingsBtn.onmouseover = () => {
    if (!isPanelOpen) settingsBtn.style.background = '#e4e4e4'
  }
  settingsBtn.onmouseout = () => {
    if (!isPanelOpen) settingsBtn.style.background = '#f4f4f4'
  }

  buttonGroup.appendChild(audioBtn)
  buttonGroup.appendChild(videoBtn)
  buttonGroup.appendChild(settingsBtn)
  buttonGroup.appendChild(settingsPanel)

  return {
    container: buttonGroup,
    audioBtn,
    videoBtn,
    settingsBtn,
    settingsPanel
  }
}

// 修改页面加载事件监听
window.addEventListener('load', async () => {
  console.log('当前页面URL:', window.location.href);

  // 更精确地检查是否在视频页面
  if (window.location.pathname.includes('/video/')) {
    console.log('检测到视频页面，注入按钮');
    const triggerBtn = injectButton();

    // 初始状态禁用小箭头
    triggerBtn.style.cursor = 'not-allowed';
    triggerBtn.style.opacity = '0.5';
    triggerBtn.style.pointerEvents = 'none';

    setTimeout(async () => {
      try {
        console.log('开始预加载服务和清晰度');
        await connectWebSocket();
        await preloadQualities();
        console.log('清晰度预加载完成');

        // 预加载成功才启用小箭头
        triggerBtn.style.cursor = 'pointer';
        triggerBtn.style.opacity = '1';
        triggerBtn.style.pointerEvents = 'auto';
      } catch (error) {
        console.error('预加载失败:', error);
        triggerBtn.style.cursor = 'not-allowed';
        triggerBtn.style.opacity = '0.5';
        triggerBtn.style.pointerEvents = 'none';

        const errorTip = document.createElement('div');
        errorTip.textContent = '加载失败，请刷新页面重试';
        errorTip.style.cssText = `
                    position: fixed;
                    right: 36px;
                    top: 50%;
                    transform: translateY(-50%);
                    background: rgba(255, 0, 0, 0.8);
                    color: #fff;
                    padding: 8px 12px;
                    border-radius: 4px;
                    font-size: 12px;
                    z-index: 1000;
                `;
        document.body.appendChild(errorTip);
        setTimeout(() => errorTip.remove(), 3000);
      }
    }, 2000);
  }
})

// 注入按钮的函数
function injectButton() {
  // 创建下拉触发器按钮
  const triggerBtn = document.createElement('div')
  triggerBtn.className = 'download-trigger-btn'
  triggerBtn.innerHTML = `
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10 17l5-5-5-5v10z"/>
    </svg>
  `
  triggerBtn.style.cssText = `
    position: fixed;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #fff;
    border-radius: 4px;
    cursor: pointer;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    transition: all 0.3s ease;
    z-index: 1000;
    color: #666;
  `

  // 创建下拉菜单
  const dropdown = document.createElement('div')
  dropdown.className = 'download-dropdown'
  dropdown.style.cssText = `
    position: fixed;
    right: 36px;
    top: 50%;
    transform: translateY(-50%);
    background: #fff;
    border-radius: 8px;
    padding: 16px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    display: none;
    z-index: 999;
    min-width: 180px;
  `

  // 创建状态提示
  const statusText = document.createElement('div')
  statusText.style.cssText = `
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 8px;
    padding: 6px 12px;
    background: rgba(0, 0, 0, 0.8);
    color: #fff;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    display: none;
    z-index: 100;
    pointer-events: none;
  `

  // 创建下载按钮容器
  const buttonContainer = document.createElement('div')
  buttonContainer.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: stretch;
    position: relative;
  `

  // 添加下载按钮组和状态文本
  const buttons = createDownloadButtons()
  buttonContainer.appendChild(buttons.container)
  buttonContainer.appendChild(statusText)

  // 将按钮容器添加到下拉菜单
  dropdown.appendChild(buttonContainer)

  // 添加到页面
  document.body.appendChild(triggerBtn)
  document.body.appendChild(dropdown)

  // 禁用点击事件
  triggerBtn.style.pointerEvents = 'none'

  // 添加触发器点击事件
  let isOpen = false
  triggerBtn.addEventListener('click', async () => {
    isOpen = !isOpen
    dropdown.style.display = isOpen ? 'block' : 'none'
    triggerBtn.style.transform = `translateY(-50%) rotate(${isOpen ? '180deg' : '0deg'})`
    triggerBtn.style.background = isOpen ? '#f4f4f4' : '#fff'

    if (isOpen) {
      connectWebSocket().then(() => {
        console.log('服务已提前准备就绪')
        return preloadQualities()  // 预加载清晰度
      }).catch(error => {
        console.error('服务准备失败:', error)
      })
    }

  })

  // 点击外部只关闭下拉菜单，不断开连接
  document.addEventListener('click', (e) => {
    if (!triggerBtn.contains(e.target) && !dropdown.contains(e.target)) {
      isOpen = false
      dropdown.style.display = 'none'
      triggerBtn.style.transform = 'translateY(-50%) rotate(0deg)'
      triggerBtn.style.background = '#fff'
    }
  })

  // 添加音频下载按钮点击事件
  buttons.audioBtn.addEventListener('click', async () => {
    if (buttons.audioBtn.disabled) return

    try {
      // 禁用所有按钮
      buttons.audioBtn.disabled = true;
      buttons.audioBtn.style.background = '#b4b4b4';
      buttons.audioBtn.style.cursor = 'not-allowed';
      buttons.videoBtn.disabled = true;
      buttons.videoBtn.style.background = '#b4b4b4';
      buttons.videoBtn.style.cursor = 'not-allowed';
      buttons.settingsBtn.style.pointerEvents = 'none';
      buttons.settingsBtn.style.opacity = '0.6';

      statusText.style.display = 'block'
      statusText.textContent = '正在准备下载...'

      // 添加进度更新监听
      const progressHandler = (event) => {
        const data = event.detail
        const percentage = data.percentage
        statusText.textContent = `下载中: ${percentage}%`
        if (percentage === 100) {
          window.removeEventListener('download_progress', progressHandler)
          statusText.textContent = '下载成功！'
          statusText.style.background = 'rgba(0, 180, 0, 0.8)'

          setTimeout(() => {
            statusText.style.display = 'none'
            // 重新启用所有按钮
            buttons.audioBtn.disabled = false;
            buttons.audioBtn.style.background = '#00aeec';
            buttons.audioBtn.style.cursor = 'pointer';
            buttons.videoBtn.disabled = false;
            buttons.videoBtn.style.background = '#ff6b6b';
            buttons.videoBtn.style.cursor = 'pointer';
            buttons.settingsBtn.style.pointerEvents = 'auto';
            buttons.settingsBtn.style.opacity = '1';
          }, 2000)
        }
      }
      window.addEventListener('download_progress', progressHandler)

      // 发送下载请求
      const response = await fetch(`${BACKEND_URL}/backend/audio-download`, { method: 'GET' })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '下载失败')
      }
    } catch (error) {
      statusText.textContent = '下载失败: ' + error.message
      statusText.style.background = 'rgba(255, 0, 0, 0.8)'

      setTimeout(() => {
        statusText.style.display = 'none'
        // 重新启用所有按钮
        buttons.audioBtn.disabled = false;
        buttons.audioBtn.style.background = '#00aeec';
        buttons.audioBtn.style.cursor = 'pointer';
        buttons.videoBtn.disabled = false;
        buttons.videoBtn.style.background = '#ff6b6b';
        buttons.videoBtn.style.cursor = 'pointer';
        buttons.settingsBtn.style.pointerEvents = 'auto';
        buttons.settingsBtn.style.opacity = '1';
      }, 3000)
    }
  })

  // 视频下载函数
  async function startVideoDownload(quality) {
    if (buttons.videoBtn.disabled) return

    try {
      // 禁用所有按钮
      buttons.audioBtn.disabled = true;
      buttons.audioBtn.style.background = '#b4b4b4';
      buttons.audioBtn.style.cursor = 'not-allowed';
      buttons.videoBtn.disabled = true;
      buttons.videoBtn.style.background = '#b4b4b4';
      buttons.videoBtn.style.cursor = 'not-allowed';
      buttons.settingsBtn.style.pointerEvents = 'none';
      buttons.settingsBtn.style.opacity = '0.6';

      statusText.style.display = 'block'
      statusText.textContent = '正在准备下载...'

      // 添加进度更新监听
      const progressHandler = (event) => {
        const data = event.detail
        const percentage = data.percentage
        statusText.textContent = `下载中: ${percentage}%`
        if (percentage === 100) {
          window.removeEventListener('download_progress', progressHandler)
          statusText.textContent = '下载成功！'
          statusText.style.background = 'rgba(0, 180, 0, 0.8)'
          setTimeout(() => {
            statusText.style.display = 'none'
            // 重新启用所有按钮
            buttons.audioBtn.disabled = false;
            buttons.audioBtn.style.background = '#00aeec';
            buttons.audioBtn.style.cursor = 'pointer';
            buttons.videoBtn.disabled = false;
            buttons.videoBtn.style.background = '#ff6b6b';
            buttons.videoBtn.style.cursor = 'pointer';
            buttons.settingsBtn.style.pointerEvents = 'auto';
            buttons.settingsBtn.style.opacity = '1';
          }, 2000)
        }
      }
      window.addEventListener('download_progress', progressHandler)

      // 发送下载请求
      const response = await fetch(`${BACKEND_URL}/backend/video-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ quality })
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || '下载失败')
      }

    } catch (error) {
      statusText.textContent = '下载失败: ' + error.message
      statusText.style.background = 'rgba(255, 0, 0, 0.8)'
      setTimeout(() => {
        statusText.style.display = 'none'
        // 重新启用所有按钮
        buttons.audioBtn.disabled = false;
        buttons.audioBtn.style.background = '#00aeec';
        buttons.audioBtn.style.cursor = 'pointer';
        buttons.videoBtn.disabled = false;
        buttons.videoBtn.style.background = '#ff6b6b';
        buttons.videoBtn.style.cursor = 'pointer';
        buttons.settingsBtn.style.pointerEvents = 'auto';
        buttons.settingsBtn.style.opacity = '1';
      }, 3000)
    }
  }

  // 视频下载按钮点击事件
  buttons.videoBtn.addEventListener('click', async () => {
    if (buttons.videoBtn.disabled) return

    try {
      // 使用已加载的清晰度创建菜单
      if (!cachedQualities) {
        throw new Error('获取视频清晰度失败')
      }

      // 如果已经存在清晰度列表，则切换其显示状态
      let qualityMenu = buttons.videoBtn.querySelector('.quality-menu')
      if (qualityMenu) {
        qualityMenu.style.display = qualityMenu.style.display === 'none' ? 'block' : 'none'
        return
      }

      // 创建质量选择菜单
      qualityMenu = document.createElement('div')
      qualityMenu.className = 'quality-menu'  // 添加类名以便查找
      qualityMenu.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            margin-top: 0;
            background: #fff;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            padding: 4px 0;
            z-index: 1000;
            min-width: 100%;
        `

      // 直接使用缓存的清晰度
      cachedQualities.forEach(quality => {
        const option = document.createElement('div')
        option.style.cssText = `
                padding: 6px 12px;
                cursor: pointer;
                font-size: 13px;
                color: #333;
                transition: all 0.2s ease;
                white-space: nowrap;
                text-align: center;
            `
        option.textContent = quality.name
        option.onmouseover = () => option.style.background = '#f5f5f5'
        option.onmouseout = () => option.style.background = 'transparent'
        option.onclick = (e) => {
          e.stopPropagation()  // 阻止事件冒泡
          qualityMenu.style.display = 'none'
          startVideoDownload(quality.code)
        }
        qualityMenu.appendChild(option)
      })

      // 修改添加菜单的设置
      buttons.videoBtn.style.position = 'relative'
      buttons.videoBtn.appendChild(qualityMenu)

      // 全局点击事件只需注册一次
      if (!window.qualityMenuHandler) {
        window.qualityMenuHandler = (e) => {
          const menu = buttons.videoBtn.querySelector('.quality-menu')
          // 如果列表存在且显示中，且点击的不是列表内部和视频下载按钮本身
          if (menu && menu.style.display !== 'none' &&
            !menu.contains(e.target) &&
            e.target !== buttons.videoBtn) {
            menu.style.display = 'none'
          }
        }
        // 确保在按钮点击事件之后执行
        document.addEventListener('click', window.qualityMenuHandler, true)
      }

    } catch (error) {
      statusText.textContent = '获取视频清晰度失败: ' + error.message
      statusText.style.background = 'rgba(255, 0, 0, 0.8)'
      statusText.style.display = 'block'

      setTimeout(() => {
        statusText.style.display = 'none'
      }, 3000)
    }
  })

  return triggerBtn
}