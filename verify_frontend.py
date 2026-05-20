import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch()
    context = browser.new_context(viewport={"width": 1280, "height": 720})
    page = context.new_page()

    page.goto("http://localhost:3000/")

    # Wait for the app to load
    page.wait_for_selector("text=Shenandoah GC Visualizer", timeout=5000)
    time.sleep(1) # wait for animation if any

    # Take a screenshot
    page.screenshot(path="/home/jules/verification/screenshots/app.png")

    print("Screenshot saved to /home/jules/verification/screenshots/app.png")

    context.close()
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
