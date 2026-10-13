import { redirect } from 'next/navigation';
import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic='force-dynamic';
export default async function Page(){await requireChatGPTUser('/');redirect('/workspace.html');}
