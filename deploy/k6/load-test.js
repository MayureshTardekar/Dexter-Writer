import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom Prometheus-friendly metrics
const compileDuration = new Trend('dexter_compile_duration_ms');
const errorRate = new Rate('dexter_error_rate');
const requestCounter = new Counter('dexter_total_requests');

export const options = {
  stages: [
    { duration: '10s', target: 10 }, // Ramp up to 10 concurrent users
    { duration: '30s', target: 25 }, // Steady state high load
    { duration: '10s', target: 0 },  // Ramp down to 0
  ],
  thresholds: {
    'dexter_error_rate': ['rate<0.10'],  // Error rate under 10%
    'dexter_compile_duration_ms': ['p(95)<30000'], // Cold TeX cache can be slow
  },
};

const TARGET_HOST = __ENV.TARGET_HOST || 'http://localhost:8080';

const sampleLatex = `
\\documentclass{article}
\\begin{document}
\\title{Dexter Write Cloud Stress Test}
\\author{Evaluation Demo}
\\date{\\today}
\\maketitle
Hello from automated Grafana k6 load test!
\\end{document}
`;

export default function () {
  group('1. Backend Health Check', function () {
    const res = http.get(`${TARGET_HOST}/health`);
    requestCounter.add(1);
    const pass = check(res, {
      'health status is 200': (r) => r.status === 200,
      'status message is ok': (r) => {
        try {
          return JSON.parse(r.body).status === 'ok';
        } catch {
          return false;
        }
      },
    });
    errorRate.add(!pass);
  });

  sleep(0.5);

  if (__ITER % 5 !== 0) {
    const metricsRes = http.get(`${TARGET_HOST}/metrics`);
    const metricsPass = check(metricsRes, {
      'metrics status is 200': (r) => r.status === 200,
    });
    errorRate.add(!metricsPass);
    sleep(1);
    return;
  }

  group('2. LaTeX Compile Microservice', function () {
    const payload = JSON.stringify({ tex: sampleLatex });
    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: '30s'
    };

    const startTime = new Date();
    const res = http.post(`${TARGET_HOST}/compile`, payload, params);
    compileDuration.add(new Date() - startTime);
    requestCounter.add(1);

    const pass = check(res, {
      'compile status is 200': (r) => r.status === 200,
      'has compilation result': (r) => r.body && r.body.length > 0,
    });
    errorRate.add(!pass);
  });

  sleep(1);
}

