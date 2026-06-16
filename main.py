import asyncio
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from downloader import Downloader
import uvicorn

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

def progress_callback(percentage, title):
    data = {'percentage': percentage, 'title': title}
    # 在运行中的事件循环里调度广播任务
    asyncio.create_task(broadcast(data))

worker = Downloader(progress_callback)

class CookiePayload(BaseModel):
    cookies: dict

@app.post('/backend/update-cookies')
async def update_cookies(payload: CookiePayload):
    connector = aiohttp.TCPConnector(limit=16)
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        "Referer": "https://www.bilibili.com/"
    }

    new_session = aiohttp.ClientSession(connector=connector, headers=headers, cookies=payload.cookies)
    if worker.session is None:
        worker.session = new_session
    else:
        old_session = worker.session
        worker.session = new_session
        await old_session.close()

connected_clients: set[WebSocket] = set()

async def broadcast(data):
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # 保持连接，忽略客户端消息
    except WebSocketDisconnect:
        connected_clients.discard(websocket)

class AudioPayload(BaseModel):
    dir: str

@app.post('/backend/audio-download')
async def handle_audio_download(payload: AudioPayload):
    try:
        result = await worker.audio_download(payload.dir)
        return {"message": "下载成功", "file_path": result}
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}

class VideoPayload(BaseModel):
    dir: str
    quality: int

@app.post('/backend/video-download')
async def handle_video_download(payload: VideoPayload):
    try:
        result = await worker.video_download(payload.dir, payload.quality)
        return {"message": "下载成功", "file_path": result}
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}

QUALITY_MAP = {
    127: '8K', 125: '4K 超清', 120: '4K 超清', 116: '1080P 60帧',
    112: '1080P+', 80: '1080P', 64: '720P', 32: '480P', 16: '360P'
}

class QualityPayload(BaseModel):
    url: str

@app.post('/backend/get-video-qualities')
async def get_video_qualities(payload: QualityPayload):
    try:
        url = payload.url
        index = url.find("BV")
        bv = url[index: index + 12]
        start = url.find('p=') + 2

        if start == 1:
            p = 1
        else:
            end = url.find('&', start)
            p = int(url[start:] if end == -1 else url[start:end])

        quality_codes = await worker.load(bv, p)
        available_qualities = [{'code': c, 'name': QUALITY_MAP.get(c, f'未知({c})')} for c in quality_codes]
        return {"qualities": available_qualities}
    except Exception as e:
        return {"error": f"视频清晰度请求失败: {e}"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5001)