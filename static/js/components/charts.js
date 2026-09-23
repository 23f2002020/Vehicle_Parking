// Thin Vue wrapper around Chart.js (loaded globally from /static/vendor/chart.umd.js).
if (window.Chart) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.weight = 600;
  Chart.defaults.color = '#666d8e';
  Chart.defaults.borderColor = '#edf0f7';
}

export const ChartCanvas = {
  props: {
    type: { type: String, default: 'bar' },
    labels: { type: Array, default: () => [] },
    datasets: { type: Array, default: () => [] },
    options: { type: Object, default: () => ({}) },
  },
  mounted() { this.draw(); },
  beforeDestroy() { if (this.chart) this.chart.destroy(); },
  watch: {
    labels() { this.draw(); },
    datasets: { deep: true, handler() { this.draw(); } },
  },
  methods: {
    draw() {
      if (!window.Chart || !this.$refs.c) return;
      if (this.chart) this.chart.destroy();
      const base = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: this.datasets.length > 1 || this.type === 'doughnut', position: 'bottom', labels: { boxWidth: 10, usePointStyle: true } } },
      };
      if (this.type !== 'doughnut' && this.type !== 'pie') {
        base.scales = { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } };
      }
      const opts = Object.assign({}, base, this.options);
      this.chart = new Chart(this.$refs.c, { type: this.type, data: { labels: this.labels, datasets: this.datasets }, options: opts });
    },
  },
  template: `<canvas ref="c" role="img"></canvas>`,
};
