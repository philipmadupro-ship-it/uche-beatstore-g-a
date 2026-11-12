import { isLabelOsEnabled } from '@/lib/labelos/flag';
import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return <LoginForm labelOs={isLabelOsEnabled()} />;
}
