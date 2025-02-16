import React, {
  useState,
  useEffect,
  useLayoutEffect,
  forwardRef,
  useRef,
  MutableRefObject,
  MouseEventHandler,
} from "react";

import {
  drawByLiveStream,
  drawByBlob,
  getBarsData,
  initialCanvasSetup,
  formatToInlineStyleValue,
  formatRecordedAudioTime,
} from "../helpers";
import { useWebWorker } from "../hooks/useWebWorker.tsx";
import { useDebounce } from "../hooks/useDebounce.tsx";
// Removed unused import "useLatest"
import {
  BarsData,
  Controls,
  BarItem,
  GetBarsDataParams,
} from "../types/types.ts";

import "../index.css";

import MicrophoneIcon from "../assets/MicrophoneIcon.tsx";
import AudioWaveIcon from "../assets/AudioWaveIcon.tsx";
import microphoneIcon from "../assets/microphone.svg";
import playIcon from "../assets/play.svg";
import pauseIcon from "../assets/pause.svg";
import stopIcon from "../assets/stop.svg";

interface VoiceVisualizerProps {
  controls: Controls;
  height?: string | number;
  width?: string | number;
  speed?: number;
  backgroundColor?: string;
  mainBarColor?: string;
  secondaryBarColor?: string;
  barWidth?: number;
  gap?: number;
  rounded?: number;
  fullscreen?: boolean;
  isControlPanelShown?: boolean;
  isDownloadAudioButtonShown?: boolean;
  animateCurrentPick?: boolean;
  onlyRecording?: boolean;
  isDefaultUIShown?: boolean;
  defaultMicrophoneIconColor?: string;
  defaultAudioWaveIconColor?: string;
  mainContainerClassName?: string;
  canvasContainerClassName?: string;
  isProgressIndicatorShown?: boolean;
  progressIndicatorClassName?: string;
  isProgressIndicatorTimeShown?: boolean;
  progressIndicatorTimeClassName?: string;
  isProgressIndicatorOnHoverShown?: boolean;
  progressIndicatorOnHoverClassName?: string;
  isProgressIndicatorTimeOnHoverShown?: boolean;
  progressIndicatorTimeOnHoverClassName?: string;
  isAudioProcessingTextShown?: boolean;
  audioProcessingTextClassName?: string;
  controlButtonsClassName?: string;
  clearButtonText?: string;
  processingAudioText?: string;
  downloadAudioText?: string;
}

const VoiceVisualizer = forwardRef<HTMLAudioElement | null, VoiceVisualizerProps>(
  (
    {
      controls: {
        audioData,
        isRecordingInProgress,
        recordedBlob,
        duration,
        currentAudioTime,
        audioSrc,
        bufferFromRecordedBlob,
        togglePauseResume,
        startRecording,
        stopRecording,
        saveAudioFile,
        isAvailableRecordedAudio,
        isPausedRecordedAudio,
        isPausedRecording,
        isProcessingStartRecording,
        isProcessingRecordedAudio,
        isCleared,
        formattedDuration,
        formattedRecordingTime,
        formattedRecordedAudioCurrentTime,
        clearCanvas,
        setCurrentAudioTime,
        isProcessingOnResize,
        _setIsProcessingOnResize,
        _setIsProcessingAudioOnComplete,
        audioRef: controlsAudioRef, // upstream now expects audioRef in controls
      },
      width = "100%",
      height = 200,
      speed = 3,
      backgroundColor = "transparent",
      mainBarColor = "#FFFFFF",
      secondaryBarColor = "#5e5e5e",
      barWidth = 2,
      gap = 1,
      rounded = 5,
      isControlPanelShown = true,
      isDownloadAudioButtonShown = false,
      animateCurrentPick = true,
      fullscreen = false,
      onlyRecording = false,
      isDefaultUIShown = true,
      defaultMicrophoneIconColor = mainBarColor,
      defaultAudioWaveIconColor = mainBarColor,
      mainContainerClassName,
      canvasContainerClassName,
      isProgressIndicatorShown = !onlyRecording,
      progressIndicatorClassName,
      isProgressIndicatorTimeShown = true,
      progressIndicatorTimeClassName,
      isProgressIndicatorOnHoverShown = !onlyRecording,
      progressIndicatorOnHoverClassName,
      isProgressIndicatorTimeOnHoverShown = true,
      progressIndicatorTimeOnHoverClassName,
      isAudioProcessingTextShown = true,
      audioProcessingTextClassName,
      controlButtonsClassName,
      clearButtonText = "Clear",
      processingAudioText = "Processing Audio...",
      downloadAudioText = "Download Audio",
    },
    ref,
  ) => {
    // Use the forwarded ref if provided, otherwise fall back to controls.audioRef.
    const audioElementRef = (ref as MutableRefObject<HTMLAudioElement | null>) || controlsAudioRef;

    const [hoveredOffsetX, setHoveredOffsetX] = useState(0);
    const [canvasCurrentWidth, setCanvasCurrentWidth] = useState(0);
    const [canvasCurrentHeight, setCanvasCurrentHeight] = useState(0);
    const [canvasWidth, setCanvasWidth] = useState(0);
    const [isRecordedCanvasHovered, setIsRecordedCanvasHovered] = useState(false);
    const [screenWidth, setScreenWidth] = useState(window.innerWidth);
    const [isResizing, setIsResizing] = useState(false);

    const isMobile = screenWidth < 768;
    const formattedSpeed = Math.trunc(speed);
    const formattedGap = Math.trunc(gap);
    const formattedBarWidth = Math.trunc(
      isMobile && formattedGap > 0 ? barWidth + 1 : barWidth,
    );
    const unit = formattedBarWidth + formattedGap * formattedBarWidth;

    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const picksRef = useRef<Array<BarItem | null>>([]);
    const indexSpeedRef = useRef(formattedSpeed);
    const indexRef = useRef(formattedBarWidth);
    const index2Ref = useRef(formattedBarWidth);
    const canvasContainerRef = useRef<HTMLDivElement | null>(null);

    const { result: barsData, setResult: setBarsData, run } = useWebWorker<BarsData[], GetBarsDataParams>({
      fn: getBarsData,
      initialValue: [],
      onMessageReceived: completedAudioProcessing,
    });

    const debouncedOnResize = useDebounce(onResize);

    // Detect Safari (which sometimes has issues with ResizeObserver)
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    // Merged resize handling: use ResizeObserver if available and not Safari,
    // otherwise fall back to the window "resize" event with multiple setTimeout calls.
    useEffect(() => {
      if (isSafari) {
        const handleResize = () => {
          setScreenWidth(window.innerWidth);
          _setIsProcessingOnResize(true);
          setIsResizing(true);
          debouncedOnResize();
        };
        window.addEventListener("resize", handleResize);
        onResize();
        setTimeout(onResize, 100);
        setTimeout(onResize, 500);
        setTimeout(onResize, 1000);
        return () => {
          window.removeEventListener("resize", handleResize);
        };
      } else if (typeof ResizeObserver !== "undefined" && canvasContainerRef.current) {
        const observer = new ResizeObserver(() => {
          setScreenWidth(window.innerWidth);
          if (isAvailableRecordedAudio) {
            _setIsProcessingOnResize(true);
            setIsResizing(true);
            debouncedOnResize();
          } else {
            onResize();
          }
        });
        observer.observe(canvasContainerRef.current);
        return () => observer.disconnect();
      } else {
        const handleResize = () => {
          setScreenWidth(window.innerWidth);
          if (isAvailableRecordedAudio) {
            _setIsProcessingOnResize(true);
            setIsResizing(true);
            debouncedOnResize();
          } else {
            onResize();
          }
        };
        window.addEventListener("resize", handleResize);
        onResize();
        return () => window.removeEventListener("resize", handleResize);
      }
    }, [width, isAvailableRecordedAudio]);

    useLayoutEffect(() => {
      if (!canvasRef.current) return;
      if (indexSpeedRef.current >= formattedSpeed || !audioData.length) {
        indexSpeedRef.current = audioData.length ? 0 : formattedSpeed;
        drawByLiveStream({
          audioData,
          unit,
          index: indexRef,
          index2: index2Ref,
          canvas: canvasRef.current,
          picks: picksRef.current,
          isRecordingInProgress,
          isPausedRecording,
          backgroundColor,
          mainBarColor,
          secondaryBarColor,
          barWidth: formattedBarWidth,
          rounded,
          animateCurrentPick,
          fullscreen,
        });
      }
      indexSpeedRef.current += 1;
    }, [
      canvasRef.current,
      audioData,
      formattedBarWidth,
      backgroundColor,
      mainBarColor,
      secondaryBarColor,
      rounded,
      fullscreen,
      canvasWidth,
    ]);

    useEffect(() => {
      if (!isAvailableRecordedAudio) return;
      if (isRecordedCanvasHovered) {
        canvasRef.current?.addEventListener("mouseleave", hideTimeIndicator);
      } else {
        canvasRef.current?.addEventListener("mouseenter", showTimeIndicator);
      }
      return () => {
        if (isRecordedCanvasHovered) {
          canvasRef.current?.removeEventListener("mouseleave", hideTimeIndicator);
        } else {
          canvasRef.current?.removeEventListener("mouseenter", showTimeIndicator);
        }
      };
    }, [isRecordedCanvasHovered, isAvailableRecordedAudio]);

    useEffect(() => {
      if (
        !bufferFromRecordedBlob ||
        !canvasRef.current ||
        isRecordingInProgress ||
        isResizing
      ) {
        return;
      }

      if (onlyRecording) {
        clearCanvas();
        return;
      }

      picksRef.current = [];
      const bufferData = bufferFromRecordedBlob.getChannelData(0);

      run({
        bufferData,
        height: canvasCurrentHeight,
        width: canvasWidth,
        barWidth: formattedBarWidth,
        gap: formattedGap,
      });

      // Use the native MouseEvent for the listener.
      const setCurrentHoveredOffsetX = (e: globalThis.MouseEvent) => {
        setHoveredOffsetX(e.offsetX);
      };

      canvasRef.current?.addEventListener("mousemove", setCurrentHoveredOffsetX);
      return () => {
        canvasRef.current?.removeEventListener("mousemove", setCurrentHoveredOffsetX);
      };
    }, [bufferFromRecordedBlob, canvasCurrentWidth, canvasCurrentHeight, gap, barWidth, isResizing]);

    useEffect(() => {
      if (
        onlyRecording ||
        !barsData?.length ||
        !canvasRef.current ||
        isProcessingRecordedAudio
      )
        return;

      if (isCleared) {
        setBarsData([]);
        return;
      }

      drawByBlob({
        barsData,
        canvas: canvasRef.current,
        barWidth: formattedBarWidth,
        gap: formattedGap,
        backgroundColor,
        mainBarColor,
        secondaryBarColor,
        currentAudioTime,
        rounded,
        duration,
      });
    }, [
      barsData,
      currentAudioTime,
      isCleared,
      rounded,
      backgroundColor,
      mainBarColor,
      secondaryBarColor,
    ]);

    useEffect(() => {
      if (isProcessingRecordedAudio && canvasRef.current) {
        initialCanvasSetup({
          canvas: canvasRef.current,
          backgroundColor,
        });
      }
    }, [isProcessingRecordedAudio]);

    function onResize() {
      if (!canvasContainerRef.current || !canvasRef.current) return;

      indexSpeedRef.current = formattedSpeed;

      const roundedHeight =
        Math.trunc(
          (canvasContainerRef.current.clientHeight * window.devicePixelRatio) / 2,
        ) * 2;

      setCanvasCurrentWidth(canvasContainerRef.current.clientWidth);
      setCanvasCurrentHeight(roundedHeight);
      setCanvasWidth(
        Math.round(
          canvasContainerRef.current.clientWidth * window.devicePixelRatio,
        ),
      );

      setIsResizing(false);
    }

    function completedAudioProcessing() {
      _setIsProcessingOnResize(false);
      _setIsProcessingAudioOnComplete(false);
      if (audioElementRef?.current && !isProcessingOnResize) {
        audioElementRef.current.src = audioSrc;
      }
    }

    const showTimeIndicator = () => {
      setIsRecordedCanvasHovered(true);
    };

    const hideTimeIndicator = () => {
      setIsRecordedCanvasHovered(false);
    };

    const handleRecordedAudioCurrentTime: MouseEventHandler<HTMLCanvasElement> = (e) => {
      // Extract the native event to access properties like clientX.
      const nativeEvent = e.nativeEvent as globalThis.MouseEvent;
      if (audioElementRef?.current && canvasRef.current) {
        const newCurrentTime =
          (duration / canvasCurrentWidth) *
          (nativeEvent.clientX - canvasRef.current.getBoundingClientRect().left);
        audioElementRef.current.currentTime = newCurrentTime;
        setCurrentAudioTime(newCurrentTime);
      }
    };

    const timeIndicatorStyleLeft = (currentAudioTime / duration) * canvasCurrentWidth;

    return (
      <div className={`voice-visualizer ${mainContainerClassName ?? ""}`}>
        <div
          className={`voice-visualizer__canvas-container ${canvasContainerClassName ?? ""}`}
          ref={canvasContainerRef}
          style={{ width: formatToInlineStyleValue(width) }}
        >
          <canvas
            ref={canvasRef}
            width={canvasWidth}
            height={canvasCurrentHeight}
            onClick={handleRecordedAudioCurrentTime}
            style={{
              height: formatToInlineStyleValue(height),
              width: canvasCurrentWidth,
            }}
          >
            Your browser does not support HTML5 Canvas.
          </canvas>
          {isDefaultUIShown && isCleared && (
            <>
              <AudioWaveIcon color={defaultAudioWaveIconColor} />
              <AudioWaveIcon color={defaultAudioWaveIconColor} reflect />
              <button
                type="button"
                onClick={startRecording}
                className="voice-visualizer__canvas-microphone-btn"
              >
                <MicrophoneIcon
                  color={defaultMicrophoneIconColor}
                  stroke={0.5}
                  className="voice-visualizer__canvas-microphone-icon"
                />
              </button>
            </>
          )}
          {isAudioProcessingTextShown && isProcessingRecordedAudio && (
            <p
              className={`voice-visualizer__canvas-audio-processing ${audioProcessingTextClassName ?? ""}`}
              style={{ color: mainBarColor }}
            >
              {processingAudioText}
            </p>
          )}
          {isRecordedCanvasHovered &&
            isAvailableRecordedAudio &&
            !isProcessingRecordedAudio &&
            !isMobile &&
            isProgressIndicatorOnHoverShown && (
              <div
                className={`voice-visualizer__progress-indicator-hovered ${progressIndicatorOnHoverClassName ?? ""}`}
                style={{ left: hoveredOffsetX }}
              >
                {isProgressIndicatorTimeOnHoverShown && (
                  <p
                    className={`voice-visualizer__progress-indicator-hovered-time ${
                      canvasCurrentWidth - hoveredOffsetX < 70
                        ? "voice-visualizer__progress-indicator-hovered-time-left"
                        : ""
                    } ${progressIndicatorTimeOnHoverClassName ?? ""}`}
                  >
                    {formatRecordedAudioTime((duration / canvasCurrentWidth) * hoveredOffsetX)}
                  </p>
                )}
              </div>
            )}
          {isProgressIndicatorShown &&
          isAvailableRecordedAudio &&
          !isProcessingRecordedAudio &&
          duration ? (
            <div
              className={`voice-visualizer__progress-indicator ${progressIndicatorClassName ?? ""}`}
              style={{
                left:
                  timeIndicatorStyleLeft < canvasCurrentWidth - 1
                    ? timeIndicatorStyleLeft
                    : canvasCurrentWidth - 1,
              }}
            >
              {isProgressIndicatorTimeShown && (
                <p
                  className={`voice-visualizer__progress-indicator-time ${
                    canvasCurrentWidth - (currentAudioTime * canvasCurrentWidth) / duration < 70
                      ? "voice-visualizer__progress-indicator-time-left"
                      : ""
                  } ${progressIndicatorTimeClassName ?? ""}`}
                >
                  {formattedRecordedAudioCurrentTime}
                </p>
              )}
            </div>
          ) : null}
        </div>

        {isControlPanelShown && (
          <>
            <div className="voice-visualizer__audio-info-container">
              {isRecordingInProgress && (
                <p className="voice-visualizer__audio-info-time">{formattedRecordingTime}</p>
              )}
              {duration && !isProcessingRecordedAudio ? <p>{formattedDuration}</p> : null}
            </div>

            <div className="voice-visualizer__buttons-container">
              {isRecordingInProgress && (
                <div className="voice-visualizer__btn-container">
                  <button
                    type="button"
                    className={`voice-visualizer__btn-left ${
                      isPausedRecording ? "voice-visualizer__btn-left-microphone" : ""
                    }`}
                    onClick={togglePauseResume}
                  >
                    <img
                      src={isPausedRecording ? microphoneIcon : pauseIcon}
                      alt={isPausedRecording ? "Play" : "Pause"}
                    />
                  </button>
                </div>
              )}
              {!isCleared && (
                <button
                  type="button"
                  className={`voice-visualizer__btn-left ${
                    isRecordingInProgress || isProcessingStartRecording
                      ? "voice-visualizer__visually-hidden"
                      : ""
                  }`}
                  onClick={togglePauseResume}
                  disabled={isProcessingRecordedAudio}
                >
                  <img
                    src={isPausedRecordedAudio ? playIcon : pauseIcon}
                    alt={isPausedRecordedAudio ? "Play" : "Pause"}
                  />
                </button>
              )}
              {isCleared && (
                <button
                  type="button"
                  className={`voice-visualizer__btn-center relative ${
                    isProcessingStartRecording
                      ? "voice-visualizer__btn-center--border-transparent"
                      : ""
                  }`}
                  onClick={startRecording}
                  disabled={isProcessingStartRecording}
                >
                  {isProcessingStartRecording && (
                    <div className="voice-visualizer__spinner-wrapper">
                      <div className="voice-visualizer__spinner" />
                    </div>
                  )}
                  <img src={microphoneIcon} alt="Microphone" />
                </button>
              )}
              <button
                type="button"
                className={`voice-visualizer__btn-center voice-visualizer__btn-center-pause ${
                  !isRecordingInProgress ? "voice-visualizer__visually-hidden" : ""
                }`}
                onClick={stopRecording}
              >
                <img src={stopIcon} alt="Stop" />
              </button>
              {!isCleared && (
                <button
                  type="button"
                  onClick={clearCanvas}
                  className={`voice-visualizer__btn ${controlButtonsClassName ?? ""}`}
                  disabled={isProcessingRecordedAudio}
                >
                  {clearButtonText}
                </button>
              )}
              {isDownloadAudioButtonShown && recordedBlob && (
                <button
                  type="button"
                  onClick={saveAudioFile}
                  className={`voice-visualizer__btn ${controlButtonsClassName ?? ""}`}
                  disabled={isProcessingRecordedAudio}
                >
                  {downloadAudioText}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  },
);

export default VoiceVisualizer;
