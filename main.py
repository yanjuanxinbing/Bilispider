import os
import asyncio
import aiohttp
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from downloader import Downloader
import uvicorn

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with aiohttp.ClientSession() as session:
        worker.set_session(session)
        yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

QUALITY_MAP = {
    127: '8K', 125: '4K 超清', 120: '4K 超清', 116: '1080P 60帧',
    112: '1080P+', 80: '1080P', 64: '720P', 32: '480P', 16: '360P'
}

connected_clients: set[WebSocket] = set()

def progress_callback(percentage, title):
    data = {'percentage': percentage, 'title': title}
    # 在运行中的事件循环里调度广播任务
    asyncio.create_task(broadcast(data))

async def broadcast(data):
    dead = set()
    for ws in connected_clients:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    connected_clients.difference_update(dead)

worker = Downloader(progress_callback)

@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # 保持连接，忽略客户端消息
    except WebSocketDisconnect:
        connected_clients.discard(websocket)


class DirPayload(BaseModel):
    path: str

@app.post('/backend/update-download-dir')
def update_download_dir(payload: DirPayload):
    path = os.path.abspath(payload.path)
    worker.set_dir(path)
    return {"message": "下载目录更新成功", "path": path, "status": "success"}


@app.get('/backend/get-current-directory')
def get_current_directory():
    return {"path": worker.get_dir(), "status": "success"}


@app.get('/backend/audio-download')
async def handle_audio_download():
    try:
        result = await worker.audio_download()
        return {"message": "下载成功", "file_path": result}
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}


class VideoPayload(BaseModel):
    quality: int

@app.post('/backend/video-download')
async def handle_video_download(payload: VideoPayload):
    try:
        result = await worker.video_download(payload.quality)
        return {"message": "下载成功", "file_path": result}
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}

class QualityPayload(BaseModel):
    url: str
    cookie: str

@app.post('/backend/get-video-qualities')
async def get_video_qualities(payload: QualityPayload):
    try:
        url = payload.url
        index = url.find("BV")
        bv = url[index: index + 12]
        if 'p=' not in url:
            p = 1
        else:
            start = url.find('p=') + 2
            end = url.find('&', start)
            p = url[start:] if end == -1 else url[start:end]
            p = int(p)
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
            "Cookie": payload.cookie,
            "Referer": "https://www.bilibili.com/"
        }
        quality_codes = await worker.load(bv, p, headers)
        available_qualities = [{'code': c, 'name': QUALITY_MAP.get(c, f'未知({c})')} for c in quality_codes]
        return {"qualities": available_qualities, "status": "success"}
    except Exception as e:
        print(f"[ERROR] get_video_qualities: {e}")
        return {"error": f"视频清晰度请求失败: {e}"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=5001)