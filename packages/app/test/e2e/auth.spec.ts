import { test, expect, type Page } from '@playwright/test';
import { E2E_SIGNUP_PASSPHRASE } from './global-setup';

// Button.Root from @vuetify/v0 always renders type="button", ignoring type="submit".
// Forms with multiple text inputs require requestSubmit() to trigger submission.
async function submitForm(page: Page): Promise<void> {
	await page.evaluate(() => {
		(document.querySelector('form') as HTMLFormElement | null)?.requestSubmit();
	});
}

async function expectSignedInAs(page: Page, username: string): Promise<void> {
	await expect(page.getByRole('button', { name: username })).toBeVisible();
}

async function signOut(page: Page, username: string): Promise<void> {
	await page.getByRole('button', { name: username }).click();
	await page.getByRole('button', { name: 'ログアウト' }).click();
}

test.describe('Authentication', () => {
	test('signin page renders form elements', async ({ page }) => {
		await page.goto('/signin');
		await expect(page.locator('#signin-username')).toBeVisible();
		await expect(page.locator('#signin-password')).toBeVisible();
		await expect(page.getByRole('button', { name: 'サインイン' })).toBeVisible();
	});

	test('shows error on wrong credentials', async ({ page }) => {
		await page.goto('/signin');
		await page.fill('#signin-username', 'nonexistent_user_xyz');
		await page.fill('#signin-password', 'wrongpassword');
		await submitForm(page);
		await expect(page.locator('.alert-error')).toBeVisible();
	});

	test('can sign in as e2e_admin via UI', async ({ page }) => {
		await page.goto('/signin');
		await page.fill('#signin-username', 'e2e_admin');
		await page.fill('#signin-password', 'e2e_password_123');
		await submitForm(page);
		await expect(page).toHaveURL('/my/buckets');
		await expectSignedInAs(page, 'e2e_admin');
	});

	test('can sign up a new account via UI and then sign in', async ({ page }) => {
		const suffix = Date.now().toString(36);
		const username = `ui_user_${suffix}`;

		await page.goto('/signin');

		await page.getByRole('tab', { name: 'サインアップ' }).click();

		await page.fill('#signup-username', username);
		await page.fill('#signup-passphrase', E2E_SIGNUP_PASSPHRASE);
		const termsCheckbox = page.getByRole('checkbox', { name: '利用規約に同意する' });
		if (await termsCheckbox.isVisible()) {
			await termsCheckbox.check();
		}
		await page.getByRole('button', { name: '確認して続行' }).click();
		await page.getByRole('button', { name: 'パスワードで登録' }).click();
		await page.fill('#signup-password', 'testpassword123');
		await submitForm(page);

		// After signup, redirect to /my/buckets
		await expect(page).toHaveURL('/my/buckets');
		await expectSignedInAs(page, username);

		// Sign out
		await signOut(page, username);
		await expect(page.getByRole('link', { name: 'サインイン' })).toBeVisible();
		await page.goto('/signin');

		// Sign in with the newly created credentials
		await page.fill('#signin-username', username);
		await page.fill('#signin-password', 'testpassword123');
		await submitForm(page);
		await expect(page).toHaveURL('/my/buckets');
		await expectSignedInAs(page, username);
	});
});
