from playwright.sync_api import sync_playwright
import os
import subprocess
import time

def main():
    os.makedirs('/home/jules/verification/videos', exist_ok=True)
    os.makedirs('/home/jules/verification/screenshots', exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            record_video_dir="/home/jules/verification/videos"
        )
        page = context.new_page()

        # Log console messages
        page.on("console", lambda msg: print(f"Browser Console: {msg.text}"))
        page.on("pageerror", lambda err: print(f"Browser Error: {err}"))

        print("Starting dev server...")
        server = subprocess.Popen(["npm", "run", "dev", "--", "--port", "5173", "--host", "0.0.0.0"])
        time.sleep(5)

        print("Navigating to app...")
        page.goto("http://localhost:5173")
        page.wait_for_selector("text=Shenandoah GC Visualizer", timeout=10000)

        print("Uploading log file...")
        with page.expect_file_chooser() as fc_info:
            page.locator('.dropzone').click()
        file_chooser = fc_info.value
        file_chooser.set_files("test-file.log")

        print("Waiting for chart to load...")
        page.wait_for_selector(".recharts-wrapper", timeout=40000)

        print("Taking screenshot...")
        page.screenshot(path="/home/jules/verification/screenshots/app.png")

        context.close()
        browser.close()
        server.terminate()
        print("Done!")

if __name__ == "__main__":
    main()
