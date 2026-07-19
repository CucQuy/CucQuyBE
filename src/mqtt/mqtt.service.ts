import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import mqtt, { MqttClient } from 'mqtt';

type QoS = 0 | 1 | 2;
type MessageHandler = (payload: unknown, topic: string) => void;

/**
 * Bọc client MQTT (Mosquitto). NGUYÊN TẮC giống RedisService: MQTT là "tốt thì
 * dùng" — nếu broker lỗi / chưa cấu hình (`MQTT_URL` trống) thì publish là no-op,
 * TUYỆT ĐỐI không làm hỏng request. Không set MQTT_URL → module tắt hẳn (local dev).
 *
 * URL prod (trong cluster): mqtt://<user>:<pass>@mosquitto.mqtt.svc.cluster.local:1883
 */
@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttService.name);
  private client: MqttClient | null = null;
  private loggedError = false;
  /** filter đã subscribe → handler, để dispatch theo topic match (hỗ trợ +, #). */
  private readonly handlers: { filter: string; handler: MessageHandler }[] = [];

  onModuleInit(): void {
    const url = process.env.MQTT_URL;
    if (!url) {
      this.logger.log('MQTT_URL chưa cấu hình — MQTT tắt (publish no-op).');
      return;
    }
    try {
      this.client = mqtt.connect(url, {
        clientId: `cucquy-backend-${process.pid}`,
        keepalive: 30,
        connectTimeout: 10_000,
        reconnectPeriod: 5_000,
        // Không queue offline vô hạn — mất kết nối thì bỏ, tránh phình bộ nhớ.
        queueQoSZero: false,
      });
      this.client.on('connect', () => {
        this.loggedError = false;
        this.logger.log('MQTT đã kết nối — publish bật');
      });
      this.client.on('error', (err) => {
        if (!this.loggedError) {
          this.logger.warn(
            `MQTT không kết nối được (publish no-op): ${err.message}`,
          );
          this.loggedError = true;
        }
      });
      this.client.on('message', (topic, buf) => this.dispatch(topic, buf));
    } catch (err) {
      this.logger.warn(`Khởi tạo MQTT thất bại (publish tắt): ${String(err)}`);
      this.client = null;
    }
  }

  onModuleDestroy(): void {
    this.client?.end(true);
  }

  /** Publish JSON payload. No-op nếu MQTT chưa kết nối (không chặn request). */
  publish(
    topic: string,
    payload: unknown,
    opts?: { qos?: QoS; retain?: boolean },
  ): void {
    const c = this.client;
    if (!c || !c.connected) return;
    try {
      c.publish(
        topic,
        JSON.stringify(payload),
        { qos: opts?.qos ?? 1, retain: opts?.retain ?? false },
        (err) => {
          if (err) this.logger.warn(`MQTT publish lỗi (${topic}): ${err.message}`);
        },
      );
    } catch (err) {
      this.logger.warn(`MQTT publish exception (${topic}): ${String(err)}`);
    }
  }

  /** Xoá retained message của topic (publish payload rỗng, retain). No-op nếu chưa nối. */
  clearRetained(topic: string): void {
    const c = this.client;
    if (!c || !c.connected) return;
    try {
      c.publish(topic, '', { qos: 1, retain: true });
    } catch (err) {
      this.logger.warn(`MQTT clearRetained lỗi (${topic}): ${String(err)}`);
    }
  }

  /**
   * Subscribe 1 topic filter (hỗ trợ wildcard + / #) + handler. Payload tự
   * JSON.parse (fallback string). No-op nếu MQTT chưa cấu hình.
   */
  subscribe(filter: string, handler: MessageHandler): void {
    const c = this.client;
    if (!c) return;
    this.handlers.push({ filter, handler });
    c.subscribe(filter, { qos: 1 }, (err) => {
      if (err) this.logger.warn(`MQTT subscribe lỗi (${filter}): ${err.message}`);
      else this.logger.log(`MQTT subscribed: ${filter}`);
    });
  }

  private dispatch(topic: string, buf: Buffer): void {
    let payload: unknown = buf.toString();
    try {
      payload = JSON.parse(buf.toString());
    } catch {
      /* giữ nguyên string nếu không phải JSON */
    }
    for (const { filter, handler } of this.handlers) {
      if (topicMatches(filter, topic)) {
        try {
          handler(payload, topic);
        } catch (err) {
          this.logger.warn(`MQTT handler lỗi (${topic}): ${String(err)}`);
        }
      }
    }
  }
}

/** Khớp topic thật với filter MQTT (single-level +, multi-level #). */
function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (f[i] === '+') {
      if (t[i] === undefined) return false;
      continue;
    }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
