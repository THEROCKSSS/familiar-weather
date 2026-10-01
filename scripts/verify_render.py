"""Render verification for Familiar Weather — real Chromium, DOM evidence."""
import asyncio, json, sys
from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8123/"

async def main():
    out = {}
    async with async_playwright() as pw:
        b = await pw.chromium.launch()
        pg = await b.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        pg.on("pageerror", lambda e: errors.append(str(e)))
        pg.on("console", lambda m: errors.append("console.error: " + m.text) if m.type == "error" else None)
        await pg.goto(URL, wait_until="networkidle", timeout=45000)
        await pg.wait_for_timeout(3500)

        out["title"] = await pg.title()
        # current panel populated?
        out["current_place"] = await pg.locator(".current-place").count()
        out["current_temp"] = (await pg.locator(".current-temp").inner_text()) if await pg.locator(".current-temp").count() else None
        out["metrics"] = await pg.locator(".metric").count()
        out["status_visible"] = await pg.locator("#current-status:visible").count()
        # brief
        out["brief_lines"] = await pg.locator(".brief-line").count()
        # hourly chart
        out["hourly_points"] = await pg.locator(".hpt").count()
        # daily rows
        out["day_rows"] = await pg.locator(".day-row").count()
        # radar tiles loaded?
        out["radar_tiles"] = await pg.locator("#radar-map img.leaflet-tile-loaded").count()
        out["radar_status"] = await pg.locator("#radar-status").inner_text()
        # interactions: unit toggle re-renders
        before = out["current_temp"]
        await pg.locator("#unit-btn").click()
        await pg.wait_for_timeout(2500)
        out["temp_after_unit"] = (await pg.locator(".current-temp").inner_text()) if await pg.locator(".current-temp").count() else None
        out["unit_changed"] = before != out["temp_after_unit"]
        # day row click -> detail
        await pg.locator(".day-row").first.click()
        out["day_detail"] = await pg.locator(".day-detail").count()
        # search flow
        await pg.fill("#search", "Chicago")
        await pg.wait_for_timeout(2500)
        out["search_results"] = await pg.locator("#search-results button[data-i]").count()
        if out["search_results"]:
            await pg.locator("#search-results button[data-i]").first.click()
            await pg.wait_for_timeout(3000)
            out["place_after_search"] = await pg.locator(".current-place").inner_text()
            out["radar_tiles_after"] = await pg.locator("#radar-map img.leaflet-tile-loaded").count()
        # screenshot
        await pg.set_viewport_size({"width": 1280, "height": 2000})
        await pg.screenshot(path="verify-desktop.png", full_page=True)
        # mobile viewport (media query check)
        pg2 = await b.new_page(viewport={"width": 390, "height": 844})
        await pg2.goto(URL, wait_until="networkidle", timeout=45000)
        await pg2.wait_for_timeout(3000)
        out["mobile_day_rain_hidden"] = await pg2.locator(".day-rain").first.is_hidden() if await pg2.locator(".day-rain").count() else None
        await pg2.screenshot(path="verify-mobile.png", full_page=True)
        out["js_errors"] = errors
        await b.close()
    print(json.dumps(out, indent=1))

asyncio.run(main())
