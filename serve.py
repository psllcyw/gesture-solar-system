# -*- coding: utf-8 -*-
"""手势太阳系本地服务：多线程 + 大并发队列（内置 http.server 默认 backlog=5，
高清贴图并行加载时会溢出导致偶发 CONNECTION_REFUSED）。

缓存策略（关键）：
  代码必须每次校验，否则改了 js/html 浏览器仍跑旧缓存；
  只有贴图、模型、wasm 这类大文件才长缓存。
"""
import os
import socket
import sys
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# 这些是"代码"，改了必须立刻生效
NO_CACHE_EXT = {'.html', '.htm', '.js', '.mjs', '.css', '.json', '.py'}
# 这些是"素材"，体积大、几乎不变，可以放心缓存
LONG_CACHE_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.task', '.wasm', '.mp3', '.mp4'}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        ext = os.path.splitext(self.path.split('?')[0])[1].lower()
        if ext in NO_CACHE_EXT or ext == '':
            # no-store: 完全禁止缓存，确保改完代码刷新即生效
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        elif ext in LONG_CACHE_EXT:
            self.send_header('Cache-Control', 'public, max-age=86400')
        else:
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 静默正常请求，只报错误，避免控制台刷屏拖慢大文件加载
        if args and str(args[0]).startswith(('4', '5')):
            super().log_message(fmt, *args)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def server_bind(self):
        # Windows 下重启服务常遇到 TIME_WAIT 占用，允许复用地址
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        super().server_bind()


def start(preferred_port, auto_open=False):
    """端口被占用时自动向后顺延，避免双击启动直接失败。"""
    for port in range(preferred_port, preferred_port + 12):
        try:
            httpd = Server(("127.0.0.1", port), Handler)
        except OSError:
            continue
        url = f"http://localhost:{port}"
        print(f"Serving {url}  (close this window to stop)")
        if auto_open:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.server_close()
        return
    print(f"端口 {preferred_port}~{preferred_port + 11} 全部被占用，请先关闭其他实例。")


if __name__ == "__main__":
    preferred = int(sys.argv[1]) if len(sys.argv) > 1 else 8200
    start(preferred, auto_open='--open' in sys.argv)
