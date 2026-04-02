/**
 * ESP32-S3-N16R8 智能语音设备主程序
 * 当前硬件：TFT屏幕 + INMP441麦克风 + 按键
 * 暂未接：MAX98357扬声器（相关代码已注释，接好后取消注释即可）
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <driver/i2s.h>
#include <TFT_eSPI.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <freertos/queue.h>
#include <freertos/semphr.h>

// ─────────────────────────────────────────────
//  硬件开关（接了哪个打开哪个）
// ─────────────────────────────────────────────
#define HW_TFT_ENABLED      1   // TFT屏幕
#define HW_MIC_ENABLED      1   // INMP441麦克风
#define HW_SPEAKER_ENABLED  0   // MAX98357扬声器（未接，关闭）
#define HW_BTN_ENABLED      1   // 按键

// ─────────────────────────────────────────────
//  引脚定义
// ─────────────────────────────────────────────
#define BTN_PIN           14

// INMP441 — I2S0
#define I2S_MIC_PORT      I2S_NUM_0
#define I2S_MIC_SCK       1
#define I2S_MIC_WS        2
#define I2S_MIC_SD        3

// MAX98357 — I2S1（未接，仅保留定义备用）
#define I2S_SPK_PORT      I2S_NUM_1
#define I2S_SPK_BCLK      5
#define I2S_SPK_LRC       6
#define I2S_SPK_DIN       7

// ─────────────────────────────────────────────
//  BLE UUIDs
// ─────────────────────────────────────────────
#define SERVICE_UUID   "12345678-1234-1234-1234-123456789abc"
#define CHAR_RX_UUID   "12345678-1234-1234-1234-123456789ab1"
#define CHAR_TX_UUID   "12345678-1234-1234-1234-123456789ab2"

// ─────────────────────────────────────────────
//  协议命令字
// ─────────────────────────────────────────────
#define CMD_TEXT_DISPLAY  0x01
#define CMD_AUDIO_CHUNK   0x02
#define CMD_AUDIO_END     0x03
#define CMD_REC_CHUNK     0x10
#define CMD_REC_END       0x11
#define CMD_EMERGENCY     0x20
#define CMD_BTN_EVENT     0x21

// ─────────────────────────────────────────────
//  常量
// ─────────────────────────────────────────────
#define SAMPLE_RATE       16000
#define I2S_REC_BUF_LEN  256
#define LONG_PRESS_MS     1500
#define DEBOUNCE_MS       50

// ─────────────────────────────────────────────
//  全局对象
// ─────────────────────────────────────────────
#if HW_TFT_ENABLED
TFT_eSPI tft = TFT_eSPI();
#endif

BLEServer*         pServer  = nullptr;
BLECharacteristic* pTxChar  = nullptr;
BLECharacteristic* pRxChar  = nullptr;

volatile bool deviceConnected = false;
volatile bool isRecording     = false;
volatile bool stopRecording   = false;

struct AudioBuf {
    uint8_t* data;
    size_t   len;
};
QueueHandle_t     audioQueue = nullptr;
SemaphoreHandle_t bleMutex   = nullptr;

TaskHandle_t recordTaskHandle = nullptr;

// ─────────────────────────────────────────────
//  屏幕辅助
// ─────────────────────────────────────────────
void tftClear(uint16_t bg = TFT_BLACK) {
#if HW_TFT_ENABLED
    tft.fillScreen(bg);
#endif
}

void displayMessage(const String& text, uint16_t color = TFT_WHITE) {
#if HW_TFT_ENABLED
    tftClear();
    tft.setTextColor(color, TFT_BLACK);
    tft.setTextWrap(true);
    tft.setCursor(4, 4);
    tft.setTextFont(2);
    tft.print(text);
#endif
    Serial.printf("[DISPLAY] %s\n", text.c_str());
}

void displayStatus(const String& line1, uint16_t color = TFT_CYAN) {
#if HW_TFT_ENABLED
    tftClear();
    tft.setTextColor(color, TFT_BLACK);
    tft.setTextFont(2);
    tft.drawString(line1, 4, tft.height() / 2 - 8);
#endif
    Serial.printf("[STATUS] %s\n", line1.c_str());
}

// ─────────────────────────────────────────────
//  I2S 初始化
// ─────────────────────────────────────────────
void initMicrophone() {
#if HW_MIC_ENABLED
    i2s_config_t cfg = {
        .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate          = SAMPLE_RATE,
        .bits_per_sample      = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count        = 4,
        .dma_buf_len          = I2S_REC_BUF_LEN,
        .use_apll             = false,
        .tx_desc_auto_clear   = false,
        .fixed_mclk           = 0
    };
    i2s_pin_config_t pins = {
        .bck_io_num   = I2S_MIC_SCK,
        .ws_io_num    = I2S_MIC_WS,
        .data_out_num = I2S_PIN_NO_CHANGE,
        .data_in_num  = I2S_MIC_SD
    };
    ESP_ERROR_CHECK(i2s_driver_install(I2S_MIC_PORT, &cfg, 0, NULL));
    ESP_ERROR_CHECK(i2s_set_pin(I2S_MIC_PORT, &pins));
    i2s_zero_dma_buffer(I2S_MIC_PORT);
    Serial.println("Microphone (INMP441) initialized");
#endif
}

void initSpeaker() {
#if HW_SPEAKER_ENABLED
    i2s_config_t cfg = {
        .mode                 = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_TX),
        .sample_rate          = SAMPLE_RATE,
        .bits_per_sample      = I2S_BITS_PER_SAMPLE_16BIT,
        .channel_format       = I2S_CHANNEL_FMT_ONLY_LEFT,
        .communication_format = I2S_COMM_FORMAT_STAND_I2S,
        .intr_alloc_flags     = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count        = 8,
        .dma_buf_len          = 512,
        .use_apll             = false,
        .tx_desc_auto_clear   = true,
        .fixed_mclk           = 0
    };
    i2s_pin_config_t pins = {
        .bck_io_num   = I2S_SPK_BCLK,
        .ws_io_num    = I2S_SPK_LRC,
        .data_out_num = I2S_SPK_DIN,
        .data_in_num  = I2S_PIN_NO_CHANGE
    };
    ESP_ERROR_CHECK(i2s_driver_install(I2S_SPK_PORT, &cfg, 0, NULL));
    ESP_ERROR_CHECK(i2s_set_pin(I2S_SPK_PORT, &pins));
    Serial.println("Speaker (MAX98357) initialized");
#else
    Serial.println("Speaker disabled (HW_SPEAKER_ENABLED=0)");
#endif
}

// ─────────────────────────────────────────────
//  FreeRTOS 任务
// ─────────────────────────────────────────────

// 音频播放任务（扬声器未接：消费队列释放内存，不写I2S）
void audioPlayTask(void* param) {
    AudioBuf* item;
    while (true) {
        if (xQueueReceive(audioQueue, &item, portMAX_DELAY) == pdTRUE) {
            if (item == nullptr) continue;
#if HW_SPEAKER_ENABLED
            size_t written = 0;
            i2s_write(I2S_SPK_PORT, item->data, item->len, &written, portMAX_DELAY);
#else
            Serial.printf("[AUDIO] Dropped %d bytes (speaker not connected)\n", item->len);
#endif
            free(item->data);
            free(item);
        }
    }
}

// 录音任务
void recordTask(void* param) {
#if HW_MIC_ENABLED
    int32_t raw32[I2S_REC_BUF_LEN];
    int16_t pcm16[I2S_REC_BUF_LEN];
    uint8_t blePkt[1 + I2S_REC_BUF_LEN * 2];
    blePkt[0] = CMD_REC_CHUNK;

    while (!stopRecording) {
        size_t bytesRead = 0;
        i2s_read(I2S_MIC_PORT, raw32, sizeof(raw32), &bytesRead, pdMS_TO_TICKS(50));

        int samples = bytesRead / 4;
        if (samples == 0) continue;

        for (int i = 0; i < samples; i++) {
            pcm16[i] = (int16_t)(raw32[i] >> 16);
        }

        size_t pcmBytes = samples * sizeof(int16_t);
        memcpy(blePkt + 1, pcm16, pcmBytes);

        if (deviceConnected && pTxChar != nullptr) {
            if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(20)) == pdTRUE) {
                pTxChar->setValue(blePkt, 1 + pcmBytes);
                pTxChar->notify();
                xSemaphoreGive(bleMutex);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(2));
    }

    // 发送结束包
    if (deviceConnected && pTxChar != nullptr) {
        uint8_t endPkt = CMD_REC_END;
        if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(100)) == pdTRUE) {
            pTxChar->setValue(&endPkt, 1);
            pTxChar->notify();
            xSemaphoreGive(bleMutex);
        }
    }
#else
    Serial.println("Mic disabled, record task exiting");
#endif
    isRecording      = false;
    recordTaskHandle = nullptr;
    vTaskDelete(NULL);
}

// ─────────────────────────────────────────────
//  业务函数
// ─────────────────────────────────────────────
void startRecording() {
    if (isRecording || !deviceConnected) return;
    stopRecording = false;
    isRecording   = true;
    displayStatus("录音中...", TFT_RED);
    xTaskCreate(recordTask, "Record", 4096, NULL, 5, &recordTaskHandle);
}

void stopRecordingAndSend() {
    if (!isRecording) return;
    stopRecording = true;
    displayStatus("处理中...", TFT_YELLOW);
}

void sendEmergency() {
    if (!deviceConnected || pTxChar == nullptr) return;

    const char* msg = "SOS! 需要紧急帮助！";
    size_t msgLen   = strlen(msg);
    uint8_t* buf    = (uint8_t*)malloc(1 + msgLen);
    if (!buf) return;

    buf[0] = CMD_EMERGENCY;
    memcpy(buf + 1, msg, msgLen);

    if (xSemaphoreTake(bleMutex, pdMS_TO_TICKS(200)) == pdTRUE) {
        pTxChar->setValue(buf, 1 + msgLen);
        pTxChar->notify();
        xSemaphoreGive(bleMutex);
    }
    free(buf);
    Serial.println("Emergency SOS sent");

#if HW_TFT_ENABLED
    for (int i = 0; i < 3; i++) {
        tft.fillScreen(TFT_RED);
        tft.setTextColor(TFT_WHITE);
        tft.setTextFont(4);
        tft.drawString("! SOS !", tft.width() / 2 - 60, tft.height() / 2 - 16);
        delay(300);
        tftClear();
        delay(200);
    }
#endif
    displayStatus("紧急消息已发送", TFT_ORANGE);
}

// ─────────────────────────────────────────────
//  按键任务
// ─────────────────────────────────────────────
void buttonTask(void* param) {
#if HW_BTN_ENABLED
    bool     prevState   = HIGH;
    bool     curState;
    uint32_t pressTime   = 0;
    bool     longHandled = false;

    while (true) {
        curState = digitalRead(BTN_PIN);

        if (curState == LOW && prevState == HIGH) {
            vTaskDelay(pdMS_TO_TICKS(DEBOUNCE_MS));
            if (digitalRead(BTN_PIN) == LOW) {
                pressTime   = millis();
                longHandled = false;
            }
        }

        if (curState == LOW && !longHandled) {
            if (millis() - pressTime >= LONG_PRESS_MS) {
                longHandled = true;
                sendEmergency();
            }
        }

        if (curState == HIGH && prevState == LOW) {
            if (!longHandled) {
                if (!isRecording) startRecording();
                else              stopRecordingAndSend();
            }
        }

        prevState = curState;
        vTaskDelay(pdMS_TO_TICKS(10));
    }
#else
    vTaskDelete(NULL);
#endif
}

// ─────────────────────────────────────────────
//  BLE 回调
// ─────────────────────────────────────────────
class MyServerCallbacks : public BLEServerCallbacks {
    void onConnect(BLEServer* s) override {
        deviceConnected = true;
        Serial.println("BLE Connected");
        displayStatus("已连接小程序", TFT_GREEN);
    }

    void onDisconnect(BLEServer* s) override {
        deviceConnected = false;
        isRecording     = false;
        stopRecording   = true;
        Serial.println("BLE Disconnected, restarting advertising...");
        displayStatus("等待连接...", TFT_CYAN);
        vTaskDelay(pdMS_TO_TICKS(500));
        BLEDevice::startAdvertising();
        Serial.println("Advertising restarted");
    }
};

class MyRxCallbacks : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* pChar) override {
        std::string val = pChar->getValue();
        if (val.empty()) return;

        uint8_t cmd = (uint8_t)val[0];

        if (cmd == CMD_TEXT_DISPLAY) {
            String text = "";
            for (size_t i = 1; i < val.size(); i++) text += (char)val[i];
            displayMessage(text);
        }

        else if (cmd == CMD_AUDIO_CHUNK) {
            size_t dataLen = val.size() - 1;
            if (dataLen == 0 || audioQueue == nullptr) return;

            AudioBuf* item = (AudioBuf*)malloc(sizeof(AudioBuf));
            if (!item) return;
            item->data = (uint8_t*)malloc(dataLen);
            if (!item->data) { free(item); return; }
            memcpy(item->data, val.c_str() + 1, dataLen);
            item->len = dataLen;

            if (xQueueSend(audioQueue, &item, 0) != pdTRUE) {
                AudioBuf* old;
                if (xQueueReceive(audioQueue, &old, 0) == pdTRUE) {
                    free(old->data);
                    free(old);
                }
                xQueueSend(audioQueue, &item, 0);
            }
        }

        else if (cmd == CMD_AUDIO_END) {
            Serial.println("Audio stream end received");
#if !HW_SPEAKER_ENABLED
            Serial.println("(Speaker not connected, audio discarded)");
#endif
        }
    }
};

// ─────────────────────────────────────────────
//  BLE 初始化
// ─────────────────────────────────────────────
void initBLE() {
    delay(500);

    BLEDevice::init("ESP32S3_Voice");
    BLEDevice::setMTU(512);

    pServer = BLEDevice::createServer();
    pServer->setCallbacks(new MyServerCallbacks());

    BLEService* pService = pServer->createService(SERVICE_UUID);

    pTxChar = pService->createCharacteristic(
        CHAR_TX_UUID,
        BLECharacteristic::PROPERTY_NOTIFY
    );
    pTxChar->addDescriptor(new BLE2902());

    pRxChar = pService->createCharacteristic(
        CHAR_RX_UUID,
        BLECharacteristic::PROPERTY_WRITE |
        BLECharacteristic::PROPERTY_WRITE_NR
    );
    pRxChar->setCallbacks(new MyRxCallbacks());

    pService->start();

    BLEAdvertising* pAdv = BLEDevice::getAdvertising();
    pAdv->addServiceUUID(SERVICE_UUID);
    pAdv->setScanResponse(true);
    pAdv->setMinPreferred(0x06);
    pAdv->setMaxPreferred(0x12);
    BLEDevice::startAdvertising();

    Serial.println("BLE advertising started: ESP32S3_Voice");
}

// ─────────────────────────────────────────────
//  Setup & Loop
// ─────────────────────────────────────────────
void setup() {
    Serial.begin(115200);
    delay(500);
    Serial.println("\n=== ESP32-S3 Voice Device Boot ===");
    Serial.printf("HW: TFT=%d  MIC=%d  SPK=%d  BTN=%d\n",
        HW_TFT_ENABLED, HW_MIC_ENABLED, HW_SPEAKER_ENABLED, HW_BTN_ENABLED);

    // ① TFT
#if HW_TFT_ENABLED
    tft.init();
    tft.setRotation(1);
    tft.fillScreen(TFT_BLACK);
    tft.setTextColor(TFT_WHITE);
    tft.setTextFont(2);
    tft.drawString("Initializing...", 4, 4);
    Serial.println("TFT initialized");
#endif

    // ② 按键
#if HW_BTN_ENABLED
    pinMode(BTN_PIN, INPUT_PULLUP);
    Serial.println("Button initialized");
#endif

    // ③ 队列 & 互斥锁（必须在BLE之前）
    audioQueue = xQueueCreate(64, sizeof(AudioBuf*));
    bleMutex   = xSemaphoreCreateMutex();
    if (!audioQueue || !bleMutex) {
        Serial.println("ERROR: FreeRTOS object creation failed!");
        while (true) delay(1000);
    }
    Serial.println("FreeRTOS queue & mutex created");

    // ④ I2S
    initMicrophone();
    initSpeaker();   // HW_SPEAKER_ENABLED=0 时内部直接跳过

    // ⑤ 任务
    xTaskCreate(audioPlayTask, "AudioPlay", 4096, NULL, 4, NULL);
    xTaskCreate(buttonTask,    "Button",    2048, NULL, 6, NULL);
    Serial.println("Tasks created");

    // ⑥ BLE（最后启动）
    initBLE();

    displayStatus("等待连接...", TFT_CYAN);
    Serial.println("Setup done.");
}

void loop() {
    vTaskDelay(pdMS_TO_TICKS(500));
}
