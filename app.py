import os
from flask import Flask, request
from flask_cors import CORS
from downloader import Downloader
from flask_socketio import SocketIO

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", ping_timeout=120, ping_interval=60)

QUALITY_MAP = {
    127: '8K',
    125: '4K 超清',
    120: '4K 超清',
    116: '1080P 60帧',
    112: '1080P+',
    80: '1080P',
    64: '720P',
    32: '480P',
    16: '360P'
}

def progress_callback(percentage, title):
    data = {
        'percentage': percentage,
        'title': title
    }
    socketio.emit('download_progress', data)

worker = Downloader(progress_callback)

@app.post('/backend/update-download-dir')
def update_download_dir():
    data = request.get_json()
    path = os.path.abspath(data["path"])
    worker.set_dir(path)
    return {
        "message": "下载目录更新成功",
        "path": path,
        "status": "success"
    }

@app.get('/backend/get-current-directory')
def get_current_directory():
    return {
        "path": worker.get_dir(),
        "status": "success"
    }

@app.get('/backend/audio-download')
async def handle_audio_download():
    try:
        result = await worker.audio_download()
        return {
            "message": "下载成功",
            "file_path": result
        }
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}, 500

@app.post('/backend/video-download')
async def handle_video_download():
    try:
        data = request.get_json()
        result = await worker.video_download(data["quality"])
        return {
            "message": "下载成功",
            "file_path": result
        }
    except Exception as e:
        return {"error": f"发生未知错误: {e}"}, 500

@app.post('/backend/get-video-qualities')
async def get_video_qualities():
    try:
        data = request.get_json()
        url = data['url']
        ua = data['ua']
        cookie = data['cookie']
        index = url.find("BV")
        bv = url[index: index + 12]
        if 'p=' not in url:
            p = 1
        else:
            start = url.find('p=') + 2
            end = url.find('&', start)
            if end == -1:
                p = url[start:]
            else:
                p = url[start:end]
            p = int(p)
        headers = {
            "User-Agent": ua,
            "Cookie": cookie,
            "Referer": url
        }
        quality_codes = await worker.load(bv, p, headers)
        available_qualities = [{'code': code, 'name': QUALITY_MAP.get(code, f'未知({code})')} for code in quality_codes]
        return {
            "qualities": available_qualities,
            "status": "success"
        }
    except Exception as e:
        return {"error": f"视频清晰度请求失败: {e}"}, 500

if __name__ == "__main__":
    socketio.run(app,
                 host='0.0.0.0',
                 port=5001,
                 allow_unsafe_werkzeug=True)
