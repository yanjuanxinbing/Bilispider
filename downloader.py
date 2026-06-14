import os
import mmap
import asyncio
import aiohttp
import subprocess

class Downloader:
    def __init__(self, callback):
        self.callback = callback
        self.dir = os.path.join(os.path.expanduser("~"), "Desktop")
        self.table = str.maketrans(r'\/:"*?<>|', '_________')
        self.session: aiohttp.ClientSession

    def set_session(self, session):
        self.session = session

    def set_dir(self, dir):
        self.dir = dir

    def get_dir(self):
        return self.dir

    async def load(self, bv, p, headers):
        self.headers = headers

        try:
            url = f"https://api.bilibili.com/x/web-interface/view?bvid={bv}"
            async with self.session.get(url, headers=headers) as res:
                data = await res.json()
            data = data["data"]["pages"][p - 1]
            cid = data["cid"]
            self.title = data["part"].translate(self.table)
        except Exception as e:
            raise Exception(f"获取视频信息失败: {e}")

        try:
            url = f"https://api.bilibili.com/x/player/wbi/playurl?&bvid={bv}&cid={cid}&fnval=4048"
            async with self.session.get(url, headers=headers) as res:
                data = await res.json()
            self.audio_url = data['data']['dash']['audio'][0]['baseUrl']
            videos = data['data']['dash']['video']
            qualities = []
            self.video_urls = {}
            for video in videos:
                if video['id'] not in qualities:
                    qualities.append(video['id'])
                    self.video_urls[video['id']] = video['baseUrl']
            return qualities
        except Exception as e:
            raise Exception(f"获取视频清晰度失败: {e}")

    async def download_chunk(self, mm, url, start, end, downloaded, total_size, callback):
        try:
            headers = self.headers.copy()
            headers['Range'] = f'bytes={start}-{end}'
            async with self.session.get(url, headers=headers) as res:
                async for data in res.content.iter_chunked(256 * 1024):
                    mm[start:start + len(data)] = data
                    start += len(data)
                    downloaded[0] += len(data)
                    callback(int(downloaded[0] / total_size * 100))
        except Exception as e:
            raise Exception(f"分片下载失败: {e}")

    async def download_file(self, url, file_path, callback):
        downloaded = [0]
        try:
            async with self.session.get(url, headers=self.headers) as res:
                total_size = int(res.headers['content-length'])
            fd = os.open(file_path, os.O_CREAT | os.O_RDWR)
            os.lseek(fd, total_size - 1, os.SEEK_SET)
            os.write(fd, b'\0')
            mm = mmap.mmap(fd, total_size, access=mmap.ACCESS_WRITE)
            chunk_size = min(max(5 * 1024 * 1024, total_size // 10), 10 * 1024 * 1024)
            tasks = []
            for i in range(0, total_size, chunk_size):
                end = min(i + chunk_size - 1, total_size - 1)
                task = self.download_chunk(
                    mm, url,
                    i, end, downloaded, total_size,
                    callback
                )
                tasks.append(task)
            await asyncio.gather(*tasks)
        except Exception as e:
            raise Exception(f"下载文件失败: {e}")
        finally:
            mm.close()
            os.close(fd)

    async def audio_download(self):
        try:
            path = os.path.join(self.dir, f"{self.title}.m4a")
            await self.download_file(self.audio_url, path, lambda p: self.callback(p, self.title))
            return path
        except Exception as e:
            self.callback(0, f"下载失败: {e}")

    async def video_download(self, quality):
        ap = 0
        vp = 0
        try:
            temp_audio = os.path.join(self.dir, f"{self.title}_temp.m4a")
            temp_video = os.path.join(self.dir, f"{self.title}_temp.mp4")
            video = os.path.join(self.dir, f"{self.title}.mp4")

            def progress_wrapper(p, file_type):
                nonlocal ap, vp
                if file_type == 'audio':
                    ap = p
                else:
                    vp = p
                # 计算总进度
                percentage = min((ap + vp) // 2, 99)
                self.callback(percentage, self.title)

            tasks = [
                self.download_file(self.audio_url, temp_audio, lambda p: progress_wrapper(p, 'audio')),
                self.download_file(self.video_urls[quality], temp_video, lambda p: progress_wrapper(p, 'video'))
            ]
            await asyncio.gather(*tasks)

            subprocess.run(
                ["ffmpeg", "-i", temp_audio, "-i", temp_video, "-c", "copy", video]
            )

            self.callback(100, self.title)
            return video
        except Exception as e:
            self.callback(0, f"下载失败: {e}")
        finally:
            os.remove(temp_audio)
            os.remove(temp_video)