"""
REAL Selenium e2e of the controls app's Keycloak login + logout (FORCED login).

login-required sends anonymous visitors straight to the Keycloak login page; the app is hidden
until logged in. Flow: open -> Keycloak login -> admin/admin -> username shown -> Logout -> forced
back to Keycloak login.

Runs HEADED by default (HEADLESS=1 to hide). Prereqs: controls `next dev` on :3000 + Keycloak :8081.

Run:  pip install selenium && python apps/controls/e2e/test_login_logout_selenium.py
"""
import os
import sys

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

APP = "http://localhost:3000/"


def make_driver():
    opts = Options()
    if os.environ.get("HEADLESS") == "1":
        opts.add_argument("--headless=new")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1280,900")
    return webdriver.Chrome(options=opts)


def at_keycloak_login(driver, wait):
    wait.until(EC.presence_of_element_located((By.ID, "username")))
    assert "/realms/aisc/" in driver.current_url, f"expected Keycloak login, got {driver.current_url}"


def main() -> int:
    driver = make_driver()
    wait = WebDriverWait(driver, 25)
    try:
        driver.get(APP)
        at_keycloak_login(driver, wait)
        print("1) anonymous visit redirected to Keycloak login (forced)")

        driver.find_element(By.ID, "username").send_keys("admin")
        driver.find_element(By.ID, "password").send_keys("admin")
        driver.find_element(By.ID, "kc-login").click()
        print("2) submitted Keycloak login")

        el = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, '[data-testid="auth-username"]')))
        assert el.text.strip() == "admin", f"expected 'admin', got '{el.text}'"
        print("3) logged in as:", el.text)

        driver.find_element(By.CSS_SELECTOR, '[data-testid="logout-button"]').click()
        at_keycloak_login(driver, wait)
        print("4) logged out -> back at Keycloak login (forced)")

        print("\nPASS: controls forced login + logout work end-to-end.")
        return 0
    except Exception as e:
        print("\nFAIL:", type(e).__name__, e)
        driver.save_screenshot("/tmp/selenium-controls-failure.png")
        print("screenshot: /tmp/selenium-controls-failure.png")
        return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
