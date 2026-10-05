import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'tests/e2e',
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'retain-on-failure',
        // Service workers can bypass request routing; the SW has its own test.
        serviceWorkers: 'block',
    },
    projects: [
        { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
        { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
    ],
    webServer: {
        command: 'node tests/serve.js',
        url: 'http://127.0.0.1:4173/index.html',
        reuseExistingServer: true,
    },
});
