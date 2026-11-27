"""Live MJPEG stream of the clownfish/Vader scene.

Renders each frame in real time (Python, ~1 fps) and streams it to the
browser as an MJPEG feed. Open http://localhost:8091/ in a browser and
put the URL in an <img> tag or just navigate to it.

Usage:  py -3 vader_live.py
"""
import io
from http.server import BaseHTTPRequestHandler, HTTPServer

import clownfish


def jpeg_bytes(img, quality=80):
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


class StreamHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        t = 0.0
        try:
            while True:
                img = clownfish.frame(t, code=True)
                data = jpeg_bytes(img)
                self.wfile.write(b"--frame\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(b"Content-Length: " + str(len(data)).encode() + b"\r\n\r\n")
                self.wfile.write(data)
                self.wfile.write(b"\r\n")
                t = (t + 1.0 / 30.0) % clownfish.LOOP
        except (BrokenPipeError, ConnectionResetError):
            pass  # browser closed the tab

    def log_message(self, *args):
        pass  # quiet


if __name__ == "__main__":
    print("Live Vader stream: http://localhost:8091/  (Ctrl+C to stop)")
    HTTPServer(("127.0.0.1", 8091), StreamHandler).serve_forever()
