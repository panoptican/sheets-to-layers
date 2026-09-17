import { render } from '@create-figma-plugin/ui';
import { App } from './app';

const mountApp = render(App);
function init(): void {
  const root = document.getElementById('app');
  if (root) mountApp(root, {});
}
if (document.readyState === 'loading')
  document.addEventListener('DOMContentLoaded', init);
else init();
