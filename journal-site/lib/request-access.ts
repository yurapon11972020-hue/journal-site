import { cookies } from 'next/headers';
import { ACCESS_COOKIE_NAME, getAccessGrant } from '@/lib/access';
export async function currentGrant() { return getAccessGrant((await cookies()).get(ACCESS_COOKIE_NAME)?.value); }
