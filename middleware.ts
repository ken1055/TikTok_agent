import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;

  // パスワード設定がなければ保護しない（ローカル開発用）
  if (!password) return NextResponse.next();

  // ログインページ・認証APIはスキップ
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/api/auth')) {
    return NextResponse.next();
  }

  // Cookieをチェック
  const auth = req.cookies.get('auth')?.value;
  if (auth === password) return NextResponse.next();

  // 未認証 → ログインページへ
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
