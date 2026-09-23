import { session } from './session.js';

export default {
  data() { return { s: session }; },
  template: `
  <div id="root">
    <router-view :key="$route.path.split('/').slice(0, 2).join('/')"></router-view>
    <toast-host></toast-host>
    <demo-clock v-if="s.token && s.demo"></demo-clock>
  </div>`,
};
